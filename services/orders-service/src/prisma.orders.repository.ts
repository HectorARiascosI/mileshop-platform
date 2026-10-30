import { Prisma, type PrismaClient } from "../generated/orders-client/index.js";

import type { OrderRecord } from "./orders.domain.js";
import {
  type ClaimedOrderEvent,
  type OrdersRepository,
  type OutboxFailureResult,
} from "./orders.repository.js";
import type { OrderCreatedEvent } from "./orders.types.js";

const OUTBOX_MAX_ATTEMPTS = 8;

function retryDelayMs(attemptCount: number): number {
  return Math.min(5_000 * 2 ** (attemptCount - 1), 300_000);
}

function mapOrderRecord(row: {
  id: string;
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{
    id: string;
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCop: number;
  }>;
}): OrderRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    customerId: row.customerId,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    subtotalCop: row.subtotalCop,
    deliveryFeeCop: row.deliveryFeeCop,
    totalCop: row.totalCop,
    status: row.status as OrderRecord["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: row.lines.map((line) => ({ ...line })),
  };
}

export class PrismaOrdersRepository implements OrdersRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async save(record: OrderRecord, event: OrderCreatedEvent): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.order.create({
        data: {
          orderId: record.orderId,
          customerId: record.customerId,
          idempotencyKey: record.idempotencyKey,
          requestFingerprint: record.requestFingerprint,
          subtotalCop: record.subtotalCop,
          deliveryFeeCop: record.deliveryFeeCop,
          totalCop: record.totalCop,
          status: record.status,
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
          payload: JSON.parse(JSON.stringify(event.payload)) as Prisma.InputJsonValue,
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

    return row ? mapOrderRecord(row) : null;
  }

  public async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      include: { lines: true },
    });

    return row ? mapOrderRecord(row) : null;
  }

  public async claimPendingEvents(
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<ClaimedOrderEvent[]> {
    await this.prisma.orderEventOutbox.updateMany({
      where: {
        status: "PROCESSING",
        attemptCount: { gte: OUTBOX_MAX_ATTEMPTS },
        leaseExpiresAt: { lte: now },
      },
      data: {
        status: "FAILED",
        claimToken: null,
        leaseExpiresAt: null,
        lastError: "Delivery lease expired after the maximum number of attempts",
      },
    });

    const candidates = await this.prisma.orderEventOutbox.findMany({
      where: {
        attemptCount: { lt: OUTBOX_MAX_ATTEMPTS },
        OR: [
          { status: "PENDING", nextAttemptAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    const claims: ClaimedOrderEvent[] = [];
    for (const candidate of candidates) {
      const claimToken = crypto.randomUUID();
      const claimed = await this.prisma.orderEventOutbox.updateMany({
        where: {
          eventId: candidate.eventId,
          attemptCount: { lt: OUTBOX_MAX_ATTEMPTS },
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: now } },
            { status: "PROCESSING", leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: "PROCESSING",
          attemptCount: { increment: 1 },
          claimToken,
          leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        },
      });
      if (claimed.count !== 1) {
        continue;
      }

      claims.push({
        event: {
          eventType: candidate.eventType as OrderCreatedEvent["eventType"],
          eventId: candidate.eventId,
          occurredAt: candidate.occurredAt.toISOString(),
          aggregateId: candidate.aggregateId,
          payload: candidate.payload as OrderCreatedEvent["payload"],
        },
        attemptCount: candidate.attemptCount + 1,
        claimToken,
      });
    }

    return claims;
  }

  public async markEventPublished(
    eventId: string,
    claimToken: string,
    publishedAt: Date,
  ): Promise<void> {
    const result = await this.prisma.orderEventOutbox.updateMany({
      where: { eventId, status: "PROCESSING", claimToken },
      data: {
        status: "PUBLISHED",
        claimToken: null,
        leaseExpiresAt: null,
        lastError: null,
        publishedAt,
      },
    });
    if (result.count !== 1) {
      throw new Error(`Outbox claim lost for event: ${eventId}`);
    }
  }

  public async markEventFailed(
    eventId: string,
    claimToken: string,
    reason: string,
    failedAt: Date,
  ): Promise<OutboxFailureResult> {
    const current = await this.prisma.orderEventOutbox.findFirst({
      where: { eventId, status: "PROCESSING", claimToken },
      select: { attemptCount: true },
    });
    if (!current) {
      throw new Error(`Outbox claim lost for event: ${eventId}`);
    }

    const nextAttemptAt = current.attemptCount >= OUTBOX_MAX_ATTEMPTS
      ? null
      : new Date(failedAt.getTime() + retryDelayMs(current.attemptCount));
    const result = await this.prisma.orderEventOutbox.updateMany({
      where: {
        eventId,
        status: "PROCESSING",
        claimToken,
        attemptCount: current.attemptCount,
      },
      data: {
        status: nextAttemptAt ? "PENDING" : "FAILED",
        claimToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: nextAttemptAt ?? failedAt,
        lastError: reason.slice(0, 1000),
      },
    });
    if (result.count !== 1) {
      throw new Error(`Outbox claim lost for event: ${eventId}`);
    }

    return { attemptCount: current.attemptCount, nextAttemptAt };
  }
}
