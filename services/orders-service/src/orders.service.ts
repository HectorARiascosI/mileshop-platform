import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { CatalogReader } from "./catalog.reader.js";
import { OrderDomain } from "./orders.domain.js";
import type { OrderRecord } from "./orders.domain.js";
import { type OrdersRepository, type ReservationIntent } from "./orders.repository.js";
import type { CreateOrderInput, Order, OrderCreatedEvent } from "./orders.types.js";
import { createOrderSchema } from "./orders.validation.js";

export const ORDER_EVENT_PUBLISHER = "ORDER_EVENT_PUBLISHER";
export const NOTIFICATION_WORKER_URL = "NOTIFICATION_WORKER_URL";
export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_RETRY_BASE_DELAY_MS = 5_000;
export const OUTBOX_RETRY_MAX_DELAY_MS = 5 * 60_000;

export class InvalidPaymentDecisionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentDecisionError";
  }
}

export type PendingOrderEvent = {
  event: OrderCreatedEvent;
  attemptCount: number;
  nextAttemptAt: Date;
};

export type OutboxFailureResult = {
  attemptCount: number;
  nextAttemptAt: Date | null;
};

function getRetryDelayMs(attemptCount: number): number {
  return Math.min(
    OUTBOX_RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1),
    OUTBOX_RETRY_MAX_DELAY_MS,
  );
}

export class NotificationPublishingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotificationPublishingError";
  }
}

export interface OrderEventPublisher {
  publishCreated(event: OrderCreatedEvent): Promise<void>;
}

export interface OrderEventOutbox {
  append(event: OrderCreatedEvent): Promise<void>;
  markPublished(eventId: string): Promise<void>;
  markFailed(eventId: string, reason: string): Promise<OutboxFailureResult>;
  listPending(now?: Date): Promise<PendingOrderEvent[]>;
}

@Injectable()
export class InMemoryOrderEventOutbox implements OrderEventOutbox {
  private readonly entries = new Map<
    string,
    {
      event: OrderCreatedEvent;
      status: "PENDING" | "PUBLISHED" | "FAILED";
      attemptCount: number;
      nextAttemptAt: Date;
      lastError?: string;
    }
  >();

  public async append(event: OrderCreatedEvent): Promise<void> {
    if (!this.entries.has(event.eventId)) {
      this.entries.set(event.eventId, {
        event,
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: new Date(0),
      });
    }
  }

  public async markPublished(eventId: string): Promise<void> {
    const entry = this.entries.get(eventId);
    if (entry) {
      entry.status = "PUBLISHED";
      delete entry.lastError;
    }
  }

  public async markFailed(
    eventId: string,
    reason: string,
    failedAt = new Date(),
  ): Promise<OutboxFailureResult> {
    const entry = this.entries.get(eventId);
    if (!entry) {
      throw new Error(`Outbox event not found: ${eventId}`);
    }

    if (entry.status === "PUBLISHED") {
      return { attemptCount: entry.attemptCount, nextAttemptAt: null };
    }

    entry.attemptCount += 1;
    entry.lastError = reason;
    entry.nextAttemptAt =
      entry.attemptCount >= OUTBOX_MAX_ATTEMPTS
        ? failedAt
        : new Date(failedAt.getTime() + getRetryDelayMs(entry.attemptCount));
    entry.status = entry.attemptCount >= OUTBOX_MAX_ATTEMPTS ? "FAILED" : "PENDING";

    return {
      attemptCount: entry.attemptCount,
      nextAttemptAt: entry.status === "PENDING" ? entry.nextAttemptAt : null,
    };
  }

  public async listPending(now = new Date()): Promise<PendingOrderEvent[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "PENDING" && entry.nextAttemptAt <= now)
      .map((entry) => ({
        event: entry.event,
        attemptCount: entry.attemptCount,
        nextAttemptAt: entry.nextAttemptAt,
      }));
  }
}

@Injectable()
export class PrismaOrderEventOutbox implements OrderEventOutbox {
  public constructor(private readonly prisma: PrismaClient) {}

  public async append(event: OrderCreatedEvent): Promise<void> {
    await this.prisma.orderEventOutbox.createMany({
      data: [{
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        occurredAt: new Date(event.occurredAt),
        payload: event.payload,
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: new Date(),
      }],
      skipDuplicates: true,
    });
  }

  public async markPublished(eventId: string): Promise<void> {
    await this.prisma.orderEventOutbox.update({
      where: { eventId },
      data: {
        status: "PUBLISHED",
        lastError: null,
        publishedAt: new Date(),
      },
    });
  }

  public async markFailed(eventId: string, reason: string): Promise<OutboxFailureResult> {
    while (true) {
      const current = await this.prisma.orderEventOutbox.findUnique({
        where: { eventId },
        select: { attemptCount: true, status: true, nextAttemptAt: true },
      });
      if (!current) {
        throw new Error(`Outbox event not found: ${eventId}`);
      }
      if (current.status === "PUBLISHED") {
        return { attemptCount: current.attemptCount, nextAttemptAt: null };
      }

      const attemptCount = current.attemptCount + 1;
      const nextAttemptAt =
        attemptCount >= OUTBOX_MAX_ATTEMPTS
          ? null
          : new Date(Date.now() + getRetryDelayMs(attemptCount));
      const result = await this.prisma.orderEventOutbox.updateMany({
        where: { eventId, attemptCount: current.attemptCount, status: { not: "PUBLISHED" } },
        data: {
          attemptCount,
          nextAttemptAt: nextAttemptAt ?? current.nextAttemptAt,
          status: nextAttemptAt ? "PENDING" : "FAILED",
          lastError: reason,
        },
      });

      if (result.count === 1) {
        return { attemptCount, nextAttemptAt };
      }
    }
  }

  public async listPending(now = new Date()): Promise<PendingOrderEvent[]> {
    const rows = await this.prisma.orderEventOutbox.findMany({
      where: {
        status: "PENDING",
        attemptCount: { lt: OUTBOX_MAX_ATTEMPTS },
        nextAttemptAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => ({
      event: {
        eventType: row.eventType as OrderCreatedEvent["eventType"],
        eventId: row.eventId,
        occurredAt: row.occurredAt.toISOString(),
        aggregateId: row.aggregateId,
        payload: row.payload as OrderCreatedEvent["payload"],
      },
      attemptCount: row.attemptCount,
      nextAttemptAt: row.nextAttemptAt,
    }));
  }
}

@Injectable()
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

    if (!response.ok) {
      throw new NotificationPublishingError(`Notification worker rejected OrderCreated.v1: ${response.status}`);
    }
  }
}

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private readonly retryIntervalMs = 5_000;
  private recoveryInProgress = false;
  private recoveryTimer?: NodeJS.Timeout;

  public constructor(
    private readonly repository: OrdersRepository,
    private readonly catalog: CatalogReader,
    private readonly eventPublisher: OrderEventPublisher,
    private readonly outbox: OrderEventOutbox = new InMemoryOrderEventOutbox(),
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
    }, this.retryIntervalMs);
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
      const pending = await this.outbox.listPending();

      for (const { event } of pending) {
        try {
          await this.eventPublisher.publishCreated(event);
          await this.outbox.markPublished(event.eventId);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Notification worker is unavailable";
          const result = await this.outbox.markFailed(event.eventId, reason);
          this.logPublishFailure(event.eventId, reason, result);
        }
      }
    } finally {
      this.recoveryInProgress = false;
    }
  }

  public async createOrder(input: CreateOrderInput): Promise<Order> {
    const parsed = createOrderSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error("Invalid order payload");
    }

    const products = await this.catalog.listActiveProducts();
    const productsById = new Map(products.map((product) => [product.id, product]));
    const requestedQuantities = new Map<string, number>();

    const validatedLines = parsed.data.lines.map((line) => {
      const product = productsById.get(line.productId);
      if (!product) {
        throw new Error(`Product line is not current: ${line.productId}`);
      }

      const requestedQuantity = (requestedQuantities.get(product.id) ?? 0) + line.quantity;
      if (requestedQuantity > product.stock) {
        throw new Error(`Insufficient stock: ${line.sku}`);
      }
      requestedQuantities.set(product.id, requestedQuantity);
      return {
        ...line,
        sku: product.sku,
        name: product.name,
        unitPriceCop: product.priceCop,
      };
    });

    const existing = await this.repository.findByIdempotencyKey(parsed.data.idempotencyKey);
    if (existing) {
      return this.returnExistingOrder(existing, parsed.data.customerId, validatedLines);
    }

    const record = OrderDomain.createOrder({
      ...parsed.data,
      lines: validatedLines,
    });
    const event = this.buildOrderCreatedEvent(record);

    if (
      this.catalog.reserveProducts &&
      this.repository.createReservationIntent &&
      this.repository.completeReservationIntent &&
      this.repository.listPendingReservationIntents
    ) {
      const intent: ReservationIntent = {
        intentId: `${record.orderId}-reservation`,
        orderId: record.orderId,
        customerId: record.customerId,
        idempotencyKey: record.idempotencyKey,
        status: "PENDING",
        lines: validatedLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
        createdAt: record.createdAt,
        nextAttemptAt: record.createdAt,
      };
      await this.repository.createReservationIntent(intent, record, event);
      await this.catalog.reserveProducts(record.orderId, intent.lines);
      await this.repository.completeReservationIntent(intent, record, event);
    }

    try {
      if (!(
        this.catalog.reserveProducts &&
        this.repository.createReservationIntent &&
        this.repository.completeReservationIntent &&
        this.repository.listPendingReservationIntents
      )) {
        await this.repository.save(record, event);
      }
    } catch (error) {
      const concurrent = await this.repository.findByIdempotencyKey(parsed.data.idempotencyKey);
      if (!concurrent) {
        throw error;
      }
      return this.returnExistingOrder(concurrent, parsed.data.customerId, validatedLines);
    }

    try {
      await this.eventPublisher.publishCreated(event);
      await this.outbox.markPublished(event.eventId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Notification worker is unavailable";
      const result = await this.outbox.markFailed(event.eventId, reason);
      this.logPublishFailure(event.eventId, reason, result);
    }

    return {
      ...OrderDomain.toOrderView(record),
      event,
    };
  }

  public async recoverPendingReservationIntents(now: Date = new Date()): Promise<void> {
    if (!this.repository.listPendingReservationIntents) {
      return;
    }
    const intents = await this.repository.listPendingReservationIntents(now);
    for (const intent of intents) {
      await this.catalog.reserveProducts?.(intent.orderId, intent.lines);
      const payload = await this.repository.getReservationIntentPayload?.(intent.intentId);
      if (payload) {
        await this.repository.completeReservationIntent?.(intent, payload.record, payload.event);
      }
    }
  }

  public async getOrderById(orderId: string): Promise<Order | null> {
    const record = await this.repository.findByOrderId(orderId);
    return record ? { ...OrderDomain.toOrderView(record) } : null;
  }

  public async approvePayment(orderId: string, adminCustomerId: string): Promise<{ result: string; order?: Order | null }> {
    const current = await this.repository.findByOrderId(orderId);
    if ((current as any)?.cancelRequestedAt && !(current as any)?.cancelResolvedAt) {
      return { result: "not-pending", order: await this.getOrderById(orderId) };
    }
    const result = await this.repository.approvePayment(
      orderId,
      adminCustomerId,
      new Date(),
      { commandId: `${orderId}-commit-inventory`, idempotencyKey: `${orderId}:COMMIT`, orderId, commandType: "COMMIT", payload: {} },
    );
    return { result, order: await this.getOrderById(orderId) };
  }

  public async rejectPayment(orderId: string, adminCustomerId: string, reason: string): Promise<{ result: string; order?: Order | null }> {
    if (!reason.trim()) throw new InvalidPaymentDecisionError("A rejection reason is required");
    const result = await this.repository.rejectPayment(
      orderId,
      adminCustomerId,
      reason.trim(),
      new Date(),
      { commandId: `${orderId}-release-inventory`, idempotencyKey: `${orderId}:RELEASE`, orderId, commandType: "RELEASE", payload: {} },
    );
    return { result, order: await this.getOrderById(orderId) };
  }

  public async requestCancellation(orderId: string, customerId: string): Promise<{ result: string; order?: Order | null }> {
    const result = await this.repository.requestCancellation(orderId, customerId, new Date());
    return {
      result: result === "requested" ? "requested" : result === "already-requested" ? "already-pending" : result,
      order: await this.getOrderById(orderId),
    };
  }

  public async recordCancellationRefund(orderId: string, adminCustomerId: string, paymentCaptured: boolean, refundReference: string | null): Promise<{ result: string }> {
    const result = await this.repository.recordCancellationRefund(orderId, adminCustomerId, paymentCaptured, refundReference, new Date());
    return { result };
  }

  public async resolveCancellationRequest(orderId: string, adminCustomerId: string, resolution: "CANCEL" | "KEEP_OPEN", note: string | null = null): Promise<{ result: string; order?: Order | null }> {
    const command = resolution === "CANCEL"
      ? { commandId: `${orderId}-release-inventory`, idempotencyKey: `${orderId}:RELEASE`, orderId, commandType: "RELEASE" as const, payload: {} }
      : undefined;
    const result = await this.repository.resolveCancellationRequest(
      orderId, adminCustomerId, resolution === "KEEP_OPEN" ? "KEEP" : "CANCEL", note, new Date(), command,
    );
    const mapped = result === "kept" ? "kept-open" : result;
    if (result === "cancelled") {
      await (this.outbox as unknown as { processPendingCommands?: () => Promise<void> }).processPendingCommands?.();
    }
    return { result: mapped, order: await this.getOrderById(orderId) };
  }

  public async cancelOrder(orderId: string, customerId: string): Promise<{ result: string }> {
    const result = await this.repository.cancelOrder(
      orderId, customerId, new Date(),
      { commandId: `${orderId}-release-inventory`, idempotencyKey: `${orderId}:RELEASE`, orderId, commandType: "RELEASE", payload: {} },
    );
    return { result };
  }

  public async listPendingCancellationRequests(): Promise<Order[]> {
    const repository = this.repository as OrdersRepository & {
      records?: Map<string, OrderRecord>;
      getPendingCancellationRequests?: () => Promise<OrderRecord[]>;
    };
    const records = repository.records
      ? [...repository.records.values()].filter((record) => (record as any).cancelRequestedAt && !(record as any).cancelResolvedAt)
      : [];
    return records.map((record) => OrderDomain.toOrderView(record));
  }

  private async returnExistingOrder(
    record: OrderRecord,
    customerId: string,
    requestedLines?: CreateOrderInput["lines"],
  ): Promise<Order> {
    if (record.customerId !== customerId) {
      throw new ConflictException("Idempotency key has already been used");
    }
    if (
      requestedLines &&
      !this.hasSameRequestedLines(record.lines, requestedLines)
    ) {
      throw new ConflictException("Idempotency key has already been used");
    }

    const event = this.buildOrderCreatedEvent(record);
    await this.outbox.append(event);
    return { ...OrderDomain.toOrderView(record), event };
  }

  private hasSameRequestedLines(
    persistedLines: OrderRecord["lines"],
    requestedLines: CreateOrderInput["lines"],
  ): boolean {
    const persistSignature = persistedLines
      .map((line) => `${line.productId}:${line.quantity}`)
      .sort();
    const requestSignature = requestedLines
      .map((line) => `${line.productId}:${line.quantity}`)
      .sort();
    return JSON.stringify(persistSignature) === JSON.stringify(requestSignature);
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
