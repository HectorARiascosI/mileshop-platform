import type { OrderRecord } from "./orders.domain.js";
import type { OrderCreatedEvent } from "./orders.types.js";

export interface OrdersRepository {
  save(record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null>;
  createReservationIntent?(intent: ReservationIntent, record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  completeReservationIntent?(intent: ReservationIntent, record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  listPendingReservationIntents?(now: Date): Promise<ReservationIntent[]>;
  getReservationIntentPayload?(intentId: string): Promise<{ record: OrderRecord; event: OrderCreatedEvent } | null>;
}

export type ReservationIntent = {
  intentId: string;
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  status: "PENDING" | "COMPLETED";
  lines: Array<{ productId: string; quantity: number }>;
  createdAt: Date;
  nextAttemptAt: Date;
};

export interface OrderEventStore {
  append(event: OrderCreatedEvent): Promise<void>;
}

export class InMemoryOrdersRepository implements OrdersRepository {
  private readonly records = new Map<string, OrderRecord>();
  private readonly orderIdsByIdempotencyKey = new Map<string, string>();
  private readonly reservationIntents = new Map<string, ReservationIntent>();
  private readonly recordIntents = new Map<
    string,
    { record: OrderRecord; event: OrderCreatedEvent }
  >();

  public constructor(private readonly outbox: OrderEventStore) {}

  public async save(record: OrderRecord, event: OrderCreatedEvent): Promise<void> {
    const existingOrderId = this.orderIdsByIdempotencyKey.get(record.idempotencyKey);
    if (existingOrderId && existingOrderId !== record.orderId) {
      throw new Error("Order idempotency key already exists");
    }

    await this.outbox.append(event);
    this.records.set(record.orderId, record);
    this.orderIdsByIdempotencyKey.set(record.idempotencyKey, record.orderId);
  }

  public async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const record = this.records.get(orderId);
    return record ? structuredClone(record) : null;
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null> {
    const orderId = this.orderIdsByIdempotencyKey.get(idempotencyKey);
    return orderId ? this.findByOrderId(orderId) : null;
  }

  public async createReservationIntent(
    intent: ReservationIntent,
    record: OrderRecord,
    event: OrderCreatedEvent,
  ): Promise<void> {
    this.reservationIntents.set(intent.intentId, structuredClone(intent));
    this.recordIntents.set(intent.intentId, { record, event });
  }

  public async completeReservationIntent(
    intent: ReservationIntent,
    record: OrderRecord,
    event: OrderCreatedEvent,
  ): Promise<void> {
    await this.save(record, event);
    this.reservationIntents.set(intent.intentId, { ...intent, status: "COMPLETED" });
  }

  public async listPendingReservationIntents(now: Date): Promise<ReservationIntent[]> {
    return [...this.reservationIntents.values()]
      .filter((intent) => intent.status === "PENDING" && intent.nextAttemptAt <= now)
      .map((intent) => structuredClone(intent));
  }

  public async getReservationIntentPayload(
    intentId: string,
  ): Promise<{ record: OrderRecord; event: OrderCreatedEvent } | null> {
    const payload = this.recordIntents.get(intentId);
    return payload
      ? structuredClone(payload)
      : null;
  }
}
