import type { PrismaClient } from "../generated/orders-client/index.js";

import type { OrderRecord } from "./orders.domain.js";
import type { OrdersRepository } from "./orders.repository.js";
import type { ReservationIntent } from "./orders.repository.js";
import type { OrderCreatedEvent } from "./orders.types.js";

export class PrismaOrdersRepository implements OrdersRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createReservationIntent(
    intent: ReservationIntent,
    record: OrderRecord,
    event: OrderCreatedEvent,
  ): Promise<void> {
    await this.prisma.reservationIntent.create({
      data: {
        ...intent,
        createdAt: intent.createdAt,
        lines: intent.lines,
        payload: JSON.parse(JSON.stringify({ record, event })),
      },
    });
  }

  public async completeReservationIntent(
    intent: ReservationIntent,
    record: OrderRecord,
    event: OrderCreatedEvent,
  ): Promise<void> {
    await this.save(record, event);
    await this.prisma.reservationIntent.update({
      where: { intentId: intent.intentId },
      data: { status: "COMPLETED" },
    });
  }

  public async listPendingReservationIntents(now: Date): Promise<ReservationIntent[]> {
    const rows = await this.prisma.reservationIntent.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      intentId: row.intentId,
      orderId: row.orderId,
      customerId: row.customerId,
      idempotencyKey: row.idempotencyKey,
      status: row.status as ReservationIntent["status"],
      lines: row.lines as ReservationIntent["lines"],
      createdAt: row.createdAt,
      nextAttemptAt: row.nextAttemptAt,
    }));
  }

  public async getReservationIntentPayload(
    intentId: string,
  ): Promise<{ record: OrderRecord; event: OrderCreatedEvent } | null> {
    const row = await this.prisma.reservationIntent.findUnique({ where: { intentId } });
    if (!row) {
      return null;
    }
    const payload = row.payload as unknown as {
      record: OrderRecord;
      event: OrderCreatedEvent;
    };
    payload.record.createdAt = new Date(payload.record.createdAt);
    payload.record.updatedAt = new Date(payload.record.updatedAt);
    payload.event.occurredAt = new Date(payload.event.occurredAt).toISOString();
    return payload;
  }

  public async save(record: OrderRecord, event: OrderCreatedEvent): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.order.create({
        data: {
          orderId: record.orderId,
          customerId: record.customerId,
          idempotencyKey: record.idempotencyKey,
          subtotalCop: record.subtotalCop,
          deliveryFeeCop: record.deliveryFeeCop,
          totalCop: record.totalCop,
          status: record.status,
          requestFingerprint: record.requestFingerprint ?? record.idempotencyKey,
          reservationExpiresAt: record.reservationExpiresAt ?? null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          lines: {
            create: record.lines.map((line) => ({
              productId: line.productId,
              sku: line.sku,
              name: line.name,
              quantity: line.quantity,
              unitPriceCop: line.unitPriceCop,
            })),
          },
        },
      });

      await transaction.orderEventOutbox.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          occurredAt: new Date(event.occurredAt),
          payload: event.payload,
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: new Date(),
        },
      });
    });
  }

  public async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({
      where: { orderId },
      include: { lines: true },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      idempotencyKey: row.idempotencyKey,
      subtotalCop: row.subtotalCop,
      deliveryFeeCop: row.deliveryFeeCop,
      totalCop: row.totalCop,
      status: row.status as OrderRecord["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines: row.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      })),
    };
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      idempotencyKey: row.idempotencyKey,
      subtotalCop: row.subtotalCop,
      deliveryFeeCop: row.deliveryFeeCop,
      totalCop: row.totalCop,
      status: row.status as OrderRecord["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines: row.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      })),
    };
  }

  public async expireDueOrders(now: Date, limit: number): Promise<number> {
    const result = await this.prisma.order.updateMany({
      where: {
        status: { in: ["PENDING", "AWAITING_PAYMENT_PROOF"] },
        reservationExpiresAt: { not: null, lte: now },
      },
      data: {
        status: "RESERVATION_EXPIRED",
        updatedAt: now,
      },
    });
    return Math.min(result.count, limit);
  }
}
