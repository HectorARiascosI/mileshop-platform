import type { OrderRecord } from "./orders.domain.js";
import type { OrderCreatedEvent } from "./orders.types.js";

export type ClaimedOrderEvent = {
  event: OrderCreatedEvent;
  attemptCount: number;
  claimToken: string;
};

export type OutboxFailureResult = {
  attemptCount: number;
  nextAttemptAt: Date | null;
};

export interface OrdersRepository {
  save(record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<OrderRecord | null>;
  claimPendingEvents(now: Date, leaseMilliseconds: number, limit: number): Promise<ClaimedOrderEvent[]>;
  markEventPublished(eventId: string, claimToken: string, publishedAt: Date): Promise<void>;
  markEventFailed(
    eventId: string,
    claimToken: string,
    reason: string,
    failedAt: Date,
  ): Promise<OutboxFailureResult>;
}

export class InMemoryOrdersRepository implements OrdersRepository {
  private readonly records = new Map<string, OrderRecord>();
  private readonly idempotencyIndex = new Map<string, string>();
  private readonly events = new Map<
    string,
    {
      event: OrderCreatedEvent;
      status: "PENDING" | "PROCESSING" | "PUBLISHED" | "FAILED";
      attemptCount: number;
      nextAttemptAt: Date;
      claimToken: string | null;
      leaseExpiresAt: Date | null;
    }
  >();

  public async save(record: OrderRecord, event: OrderCreatedEvent): Promise<void> {
    const idempotencyIndexKey = `${record.customerId}:${record.idempotencyKey}`;
    if (this.idempotencyIndex.has(idempotencyIndexKey)) {
      throw new Error("Duplicate idempotency key");
    }

    this.records.set(record.orderId, structuredClone(record));
    this.idempotencyIndex.set(idempotencyIndexKey, record.orderId);
    this.events.set(event.eventId, {
      event: structuredClone(event),
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: new Date(0),
      claimToken: null,
      leaseExpiresAt: null,
    });
  }

  public async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const record = this.records.get(orderId);
    return record ? structuredClone(record) : null;
  }

  public async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<OrderRecord | null> {
    const orderId = this.idempotencyIndex.get(`${customerId}:${idempotencyKey}`);
    return orderId ? this.findByOrderId(orderId) : null;
  }

  public async claimPendingEvents(
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<ClaimedOrderEvent[]> {
    const claims: ClaimedOrderEvent[] = [];

    for (const entry of this.events.values()) {
      if (claims.length >= limit) {
        break;
      }

      const isPending = entry.status === "PENDING" && entry.nextAttemptAt <= now;
      const isExpired = entry.status === "PROCESSING" &&
        entry.leaseExpiresAt !== null &&
        entry.leaseExpiresAt <= now;
      if (isExpired && entry.attemptCount >= 8) {
        entry.status = "FAILED";
        entry.claimToken = null;
        entry.leaseExpiresAt = null;
        continue;
      }
      if (!isPending && !isExpired) {
        continue;
      }
      if (entry.attemptCount >= 8) {
        continue;
      }

      const claimToken = crypto.randomUUID();
      entry.status = "PROCESSING";
      entry.attemptCount += 1;
      entry.claimToken = claimToken;
      entry.leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds);
      claims.push({
        event: structuredClone(entry.event),
        attemptCount: entry.attemptCount,
        claimToken,
      });
    }

    return claims;
  }

  public async markEventPublished(
    eventId: string,
    claimToken: string,
    _publishedAt: Date,
  ): Promise<void> {
    const entry = this.events.get(eventId);
    if (!entry || entry.status !== "PROCESSING" || entry.claimToken !== claimToken) {
      throw new Error(`Outbox claim lost for event: ${eventId}`);
    }
    entry.status = "PUBLISHED";
    entry.claimToken = null;
    entry.leaseExpiresAt = null;
  }

  public async markEventFailed(
    eventId: string,
    claimToken: string,
    _reason: string,
    failedAt: Date,
  ): Promise<OutboxFailureResult> {
    const entry = this.events.get(eventId);
    if (!entry || entry.status !== "PROCESSING" || entry.claimToken !== claimToken) {
      throw new Error(`Outbox claim lost for event: ${eventId}`);
    }

    const nextAttemptAt = entry.attemptCount >= 8
      ? null
      : new Date(failedAt.getTime() + Math.min(5_000 * 2 ** (entry.attemptCount - 1), 300_000));
    entry.status = nextAttemptAt ? "PENDING" : "FAILED";
    entry.claimToken = null;
    entry.leaseExpiresAt = null;
    if (nextAttemptAt) {
      entry.nextAttemptAt = nextAttemptAt;
    }
    return { attemptCount: entry.attemptCount, nextAttemptAt };
  }
}
