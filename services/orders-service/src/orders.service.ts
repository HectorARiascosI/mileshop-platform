import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { CatalogReader } from "./catalog.reader.js";
import { FREE_DELIVERY_THRESHOLD_COP, OrderDomain } from "./orders.domain.js";
import type { OrderRecord } from "./orders.domain.js";
import type {
  OrdersRepository,
  OutboxFailureResult,
} from "./orders.repository.js";
import {
  InvalidOrderError,
  OrderConflictError,
  createOrderSchema,
} from "./orders.validation.js";
import type {
  CreateOrderInput,
  CreatedOrder,
  Order,
  OrderCreatedEvent,
} from "./orders.types.js";

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_LEASE_MS = 30_000;
const OUTBOX_POLL_INTERVAL_MS = 5_000;
const OUTBOX_BATCH_SIZE = 25;

export interface OrderEventPublisher {
  publishCreated(event: OrderCreatedEvent): Promise<void>;
}

export class HttpOrderEventPublisher implements OrderEventPublisher {
  public constructor(
    private readonly fetcher: typeof fetch,
    private readonly notificationWorkerUrl: string,
  ) {}

  public async publishCreated(event: OrderCreatedEvent): Promise<void> {
    const response = await this.fetcher(`${this.notificationWorkerUrl}/events/order-created`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok || response.status === 202) {
      throw new Error(`Notification worker did not finish event delivery (${response.status})`);
    }
  }
}

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private recoveryInProgress = false;
  private recoveryTimer?: NodeJS.Timeout;

  public constructor(
    private readonly repository: OrdersRepository,
    private readonly catalog: CatalogReader,
    private readonly eventPublisher: OrderEventPublisher,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.recoverPendingEvents();
    this.recoveryTimer = setInterval(() => {
      void this.recoverPendingEvents().catch((error: unknown) => {
        this.logger.error(
          "Failed to recover pending order events",
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, OUTBOX_POLL_INTERVAL_MS);
  }

  public onModuleDestroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }
  }

  public async recoverPendingEvents(): Promise<void> {
    if (this.recoveryInProgress) {
      return;
    }

    this.recoveryInProgress = true;
    try {
      const claims = await this.repository.claimPendingEvents(
        new Date(),
        OUTBOX_LEASE_MS,
        OUTBOX_BATCH_SIZE,
      );
      for (const claim of claims) {
        try {
          await this.eventPublisher.publishCreated(claim.event);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Unknown event delivery error";
          try {
            const result = await this.repository.markEventFailed(
              claim.event.eventId,
              claim.claimToken,
              reason,
              new Date(),
            );
            this.logPublishFailure(claim.event.eventId, reason, result);
          } catch (persistenceError) {
            this.logger.error(
              `Failed to persist delivery failure for event ${claim.event.eventId}`,
              persistenceError instanceof Error ? persistenceError.stack : undefined,
            );
          }
          continue;
        }

        try {
          await this.repository.markEventPublished(
            claim.event.eventId,
            claim.claimToken,
            new Date(),
          );
        } catch (error) {
          this.logger.error(
            `Event ${claim.event.eventId} was delivered but its outbox claim could not be completed; it will be retried after lease expiry`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } finally {
      this.recoveryInProgress = false;
    }
  }

  public async createOrder(
    input: unknown,
    idempotencyKey: string | undefined,
  ): Promise<CreatedOrder> {
    const parsedBody =
      typeof input === "object" && input !== null && !Array.isArray(input)
        ? input
        : {};
    const parsed = createOrderSchema.safeParse({ ...parsedBody, idempotencyKey });
    if (!parsed.success) {
      throw new InvalidOrderError("Invalid order payload");
    }

    const command: CreateOrderInput = parsed.data;
    const requestedSubtotal = command.lines.reduce(
      (total, line) => total + line.unitPriceCop * line.quantity,
      0,
    );
    if (!Number.isSafeInteger(requestedSubtotal)) {
      throw new InvalidOrderError("Order total exceeds the supported amount");
    }
    const requestedDeliveryFee = requestedSubtotal >= FREE_DELIVERY_THRESHOLD_COP
      ? 0
      : Math.max(12_000, Math.round(requestedSubtotal * 0.08));
    if (!Number.isSafeInteger(requestedSubtotal + requestedDeliveryFee)) {
      throw new InvalidOrderError("Order total exceeds the supported amount");
    }
    const fingerprint = OrderDomain.fingerprint(command);
    const existing = await this.repository.findByIdempotencyKey(
      command.customerId,
      command.idempotencyKey,
    );
    if (existing) {
      return this.returnExistingOrder(existing, fingerprint);
    }

    const products = await this.catalog.listActiveProducts();
    const productsById = new Map(products.map((product) => [product.id, product]));
    const requestedQuantities = new Map<string, number>();

    const validatedLines = command.lines.map((line) => {
      const product = productsById.get(line.productId);
      if (!product) {
        throw new InvalidOrderError(`Product line is not current: ${line.productId}`);
      }
      if (product.sku !== line.sku) {
        throw new InvalidOrderError(`Product identity is not current: ${line.sku}`);
      }
      if (product.priceCop !== line.unitPriceCop) {
        throw new InvalidOrderError(`Product price is not current: ${line.sku}`);
      }

      const requestedQuantity = (requestedQuantities.get(product.id) ?? 0) + line.quantity;
      if (requestedQuantity > product.stock) {
        throw new InvalidOrderError(`Insufficient stock: ${line.sku}`);
      }
      requestedQuantities.set(product.id, requestedQuantity);
      return { ...line, name: product.name };
    });

    const record = OrderDomain.createOrder({
      ...command,
      lines: validatedLines,
    });
    const event = this.buildOrderCreatedEvent(record);

    try {
      await this.repository.save(record, event);
    } catch (error) {
      const concurrent = await this.repository.findByIdempotencyKey(
        command.customerId,
        command.idempotencyKey,
      );
      if (!concurrent) {
        throw error;
      }
      return this.returnExistingOrder(concurrent, fingerprint);
    }

    await this.recoverPendingEvents();
    return { ...OrderDomain.toOrderView(record), event };
  }

  public async getOrderById(orderId: string): Promise<Order | null> {
    const record = await this.repository.findByOrderId(orderId);
    return record ? { ...OrderDomain.toOrderView(record) } : null;
  }

  private returnExistingOrder(record: OrderRecord, fingerprint: string): CreatedOrder {
    if (record.requestFingerprint !== fingerprint) {
      throw new OrderConflictError("Idempotency key was reused with a different order payload");
    }

    return {
      ...OrderDomain.toOrderView(record),
      event: this.buildOrderCreatedEvent(record),
    };
  }

  private buildOrderCreatedEvent(record: OrderRecord): OrderCreatedEvent {
    return {
      eventType: "OrderCreated.v1",
      eventId: `${record.orderId}-created`,
      occurredAt: record.createdAt.toISOString(),
      aggregateId: record.orderId,
      payload: {
        customerId: record.customerId,
        subtotalCop: record.subtotalCop,
        deliveryFeeCop: record.deliveryFeeCop,
        totalCop: record.totalCop,
        currency: "COP",
        lines: record.lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPriceCop: line.unitPriceCop,
        })),
      },
    };
  }

  private logPublishFailure(
    eventId: string,
    reason: string,
    result: OutboxFailureResult,
  ): void {
    if (result.nextAttemptAt) {
      this.logger.warn(
        `Order event ${eventId} failed on attempt ${result.attemptCount}/${OUTBOX_MAX_ATTEMPTS}; retry scheduled at ${result.nextAttemptAt.toISOString()}: ${reason}`,
      );
      return;
    }

    this.logger.error(
      `Order event ${eventId} exhausted ${OUTBOX_MAX_ATTEMPTS} delivery attempts and requires operator intervention: ${reason}`,
    );
  }
}
