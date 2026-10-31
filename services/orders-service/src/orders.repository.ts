import type { OrderRecord } from "./orders.domain.js";
import type { OrderCreatedEvent } from "./orders.types.js";
import type { ClaimedInventoryCommand, InventoryCommand, InventoryCommandFailureResult } from "./inventory-command.repository.js";

export interface OrdersRepository {
  save(record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null>;
  createReservationIntent?(intent: ReservationIntent, record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  completeReservationIntent?(intent: ReservationIntent, record: OrderRecord, event: OrderCreatedEvent): Promise<void>;
  listPendingReservationIntents?(now: Date): Promise<ReservationIntent[]>;
  getReservationIntentPayload?(intentId: string): Promise<{ record: OrderRecord; event: OrderCreatedEvent } | null>;
  expireDueOrders(now: Date, limit: number): Promise<number>;
  approvePayment(orderId: string, adminCustomerId: string, decidedAt: Date, command: InventoryCommand): Promise<"approved" | "already-approved" | "decision-conflict" | "not-pending" | "cancel-requested">;
  rejectPayment(orderId: string, adminCustomerId: string, reason: string, decidedAt: Date, command: InventoryCommand): Promise<"rejected" | "already-rejected" | "decision-conflict" | "not-pending" | "cancel-requested">;
  markCommandCompleted(commandId: string, claimToken: string, completedAt: Date): Promise<void>;
  requestCancellation(orderId: string, customerId: string, requestedAt: Date): Promise<"requested" | "not-pending-proof" | "not-owner" | "already-resolved" | "already-requested">;
  recordCancellationRefund(orderId: string, adminCustomerId: string, paymentCaptured: boolean, refundReference: string | null, recordedAt: Date): Promise<"recorded" | "not-pending">;
  resolveCancellationRequest(orderId: string, adminCustomerId: string, resolution: "CANCEL" | "KEEP", note: string | null, resolvedAt: Date, command?: InventoryCommand): Promise<"cancelled" | "kept" | "refund-required" | "refund-not-recorded" | "not-pending">;
  cancelOrder(orderId: string, customerId: string, cancelledAt: Date, command: InventoryCommand): Promise<"cancelled" | "already-cancelled" | "not-cancellable" | "not-owner" | "not-found" | "not-active">;
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
  private readonly commands = new Map<string, { command: InventoryCommand; status: string; claimToken: string | null; nextAttemptAt: Date }>();
  private readonly orderIdsByIdempotencyKey = new Map<string, string>();
  private readonly reservationIntents = new Map<string, ReservationIntent>();
  private readonly recordIntents = new Map<
    string,
    { record: OrderRecord; event: OrderCreatedEvent }
  >();

  public constructor(private readonly outbox?: OrderEventStore) {}

  public async expireDueOrders(_now: Date, _limit: number): Promise<number> {
    return 0;
  }

  public add(command: InventoryCommand): void {
    this.commands.set(command.commandId, {
      command: structuredClone(command),
      status: "PENDING",
      claimToken: null,
      nextAttemptAt: new Date(0),
    });
  }

  public async claimPendingCommands(
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<ClaimedInventoryCommand[]> {
    const claims: ClaimedInventoryCommand[] = [];
    for (const entry of this.commands.values()) {
      if (claims.length >= limit) break;
      if (entry.status !== "PENDING" || entry.nextAttemptAt > now) continue;
      entry.status = "PROCESSING";
      entry.claimToken = crypto.randomUUID();
      claims.push({ command: structuredClone(entry.command), attemptCount: 1, claimToken: entry.claimToken });
    }
    return claims;
  }

  public async markCommandRejected(commandId: string, _claimToken: string, _reason: string, _rejectedAt: Date, terminalOrderStatus?: "RESERVATION_FAILED" | "RESERVATION_EXPIRED"): Promise<void> {
    const command = this.commands.get(commandId)?.command;
    const record = command ? this.records.get(command.orderId) : undefined;
    if (record && terminalOrderStatus) record.status = terminalOrderStatus;
  }
  public async markCommandFailed(): Promise<InventoryCommandFailureResult> {
    return { attemptCount: 1, nextAttemptAt: new Date() };
  }

  public async save(record: OrderRecord, event: OrderCreatedEvent, command?: InventoryCommand): Promise<void> {
    const existingOrderId = this.orderIdsByIdempotencyKey.get(record.idempotencyKey);
    if (existingOrderId && existingOrderId !== record.orderId) {
      throw new Error("Order idempotency key already exists");
    }

    await this.outbox?.append(event);
    this.records.set(record.orderId, record);
    this.orderIdsByIdempotencyKey.set(record.idempotencyKey, record.orderId);
    if (command) this.add(command);
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
    record.status = "AWAITING_PAYMENT_PROOF";
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

  public async approvePayment(orderId: string, _adminCustomerId: string, _decidedAt: Date, command: InventoryCommand): Promise<any> {
    const record = this.records.get(orderId);
    if (!record || record.status !== "PAYMENT_REVIEW_PENDING") return "not-pending";
    record.status = "PAYMENT_APPROVED_FINALIZING";
    this.add(command);
    return "approved";
  }

  public async rejectPayment(orderId: string, _adminCustomerId: string, _reason: string, _decidedAt: Date, command: InventoryCommand): Promise<any> {
    const record = this.records.get(orderId);
    if (!record || record.status !== "PAYMENT_REVIEW_PENDING") return "not-pending";
    record.status = "CANCELLED";
    this.add(command);
    return "rejected";
  }

  public async markCommandCompleted(commandId: string): Promise<void> {
    const entry = this.commands.get(commandId);
    if (entry) entry.status = "COMPLETED";
  }

  public async requestCancellation(orderId: string, customerId: string, requestedAt: Date): Promise<any> {
    const record = this.records.get(orderId);
    if (!record || record.customerId !== customerId) return "not-owner";
    if ((record as any).cancelRequestedAt) return "already-requested";
    if (record.status !== "PAYMENT_REVIEW_PENDING") return "not-pending-proof";
    (record as any).cancelRequestedAt = requestedAt;
    return "requested";
  }

  public async recordCancellationRefund(orderId: string, adminCustomerId: string, paymentCaptured: boolean, refundReference: string | null, recordedAt: Date): Promise<any> {
    const record = this.records.get(orderId);
    if (!record || record.status !== "PAYMENT_REVIEW_PENDING") return "not-pending";
    Object.assign(record as any, {
      cancelPaymentCaptured: paymentCaptured,
      externalRefundRecordedByCustomerId: adminCustomerId,
      externalRefundReference: refundReference,
      externalRefundHandledAt: recordedAt,
    });
    return "recorded";
  }

  public async resolveCancellationRequest(orderId: string, adminCustomerId: string, resolution: "CANCEL" | "KEEP", note: string | null, resolvedAt: Date, command?: InventoryCommand): Promise<any> {
    const record = this.records.get(orderId);
    if (!record || !(record as any).cancelRequestedAt || (record as any).cancelResolvedAt) return "not-pending";
    if (resolution === "KEEP") {
      Object.assign(record as any, { cancelResolvedAt: resolvedAt, cancelResolution: "KEPT_OPEN", cancelResolvedByCustomerId: adminCustomerId, cancelResolutionNote: note });
      return "kept";
    }
    if (!(record as any).cancelPaymentCaptured) return "refund-not-recorded";
    record.status = "CANCELLED";
    Object.assign(record as any, { cancelResolvedAt: resolvedAt, cancelResolution: "CANCELLED", cancelResolvedByCustomerId: adminCustomerId, cancelResolutionNote: note });
    if (command) this.add(command);
    return "cancelled";
  }

  public async cancelOrder(orderId: string, customerId: string, cancelledAt: Date, command: InventoryCommand): Promise<any> {
    const record = this.records.get(orderId);
    if (!record) return "not-found";
    if (record.customerId !== customerId) return "not-owner";
    if (record.status === "CANCELLED") return "already-cancelled";
    if (record.status !== "AWAITING_PAYMENT_PROOF") return "not-cancellable";
    record.status = "CANCELLED";
    record.updatedAt = cancelledAt;
    this.add(command);
    return "cancelled";
  }
}
