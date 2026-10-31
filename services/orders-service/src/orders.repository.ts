import type { OrderRecord } from "./orders.domain.js";
import type { OrderCreatedEvent } from "./orders.types.js";
import {
  InMemoryInventoryCommandRepository,
  type InventoryCommand,
  createInventoryReleaseCommand,
} from "./inventory-command.repository.js";
import type { PendingCancellationRequest } from "./orders.types.js";

export type ClaimedOrderEvent = {
  event: OrderCreatedEvent;
  attemptCount: number;
  claimToken: string;
};

export type OutboxFailureResult = {
  attemptCount: number;
  nextAttemptAt: Date | null;
};

export type PaymentApprovalResult =
  | "approved"
  | "already-approved"
  | "not-found"
  | "not-pending"
  | "decision-conflict";

export type PaymentRejectionResult =
  | "rejected"
  | "already-rejected"
  | "not-found"
  | "not-pending"
  | "decision-conflict";

export type OrderCancellationResult =
  | "cancelled"
  | "already-cancelled"
  | "not-found"
  | "not-cancellable";

export type CancellationRequestResult =
  | "requested"
  | "already-pending"
  | "already-resolved"
  | "not-found"
  | "not-eligible";

export type CancellationRefundRecordResult =
  | "recorded"
  | "already-recorded"
  | "not-found"
  | "not-pending"
  | "conflict";

export type CancellationResolutionAction = "CANCEL" | "KEEP_OPEN";

export type CancellationResolutionResult =
  | "cancelled"
  | "kept-open"
  | "already-resolved"
  | "refund-not-recorded"
  | "not-found"
  | "not-pending";

export interface OrdersRepository {
  save(
    record: OrderRecord,
    event: OrderCreatedEvent,
    inventoryCommand: InventoryCommand,
  ): Promise<void>;
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<OrderRecord | null>;
  approvePayment(
    orderId: string,
    adminCustomerId: string,
    decidedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<PaymentApprovalResult>;
  rejectPayment(
    orderId: string,
    adminCustomerId: string,
    reason: string,
    decidedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<PaymentRejectionResult>;
  cancelOrder(
    orderId: string,
    customerId: string,
    cancelledAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<OrderCancellationResult>;
  requestCancellation(
    orderId: string,
    customerId: string,
    requestedAt: Date,
  ): Promise<CancellationRequestResult>;
  listPendingCancellationRequests(): Promise<PendingCancellationRequest[]>;
  recordCancellationRefund(
    orderId: string,
    adminCustomerId: string,
    paymentCaptured: boolean,
    externalRefundReference: string | null,
    recordedAt: Date,
  ): Promise<CancellationRefundRecordResult>;
  resolveCancellationRequest(
    orderId: string,
    adminCustomerId: string,
    action: CancellationResolutionAction,
    note: string,
    resolvedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<CancellationResolutionResult>;
  expireDueOrders(now: Date, limit: number): Promise<number>;
  claimPendingEvents(now: Date, leaseMilliseconds: number, limit: number): Promise<ClaimedOrderEvent[]>;
  markEventPublished(eventId: string, claimToken: string, publishedAt: Date): Promise<void>;
  markEventFailed(
    eventId: string,
    claimToken: string,
    reason: string,
    failedAt: Date,
  ): Promise<OutboxFailureResult>;
}

export class InMemoryOrdersRepository
  extends InMemoryInventoryCommandRepository
  implements OrdersRepository {
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

  public async save(
    record: OrderRecord,
    event: OrderCreatedEvent,
    inventoryCommand: InventoryCommand,
  ): Promise<void> {
    const idempotencyIndexKey = `${record.customerId}:${record.idempotencyKey}`;
    if (this.idempotencyIndex.has(idempotencyIndexKey)) {
      throw new Error("Duplicate idempotency key");
    }

    this.records.set(record.orderId, structuredClone(record));
    this.idempotencyIndex.set(idempotencyIndexKey, record.orderId);
    this.add(inventoryCommand);
    this.events.set(event.eventId, {
      event: structuredClone(event),
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: new Date(0),
      claimToken: null,
      leaseExpiresAt: null,
    });
  }

  public override async markCommandCompleted(
    commandId: string,
    claimToken: string,
    completedAt: Date,
  ): Promise<void> {
    const entry = this.commands.get(commandId);
    if (!entry || entry.command.commandType !== "RESERVE") {
      if (entry?.command.commandType === "COMMIT") {
        const record = this.records.get(entry.command.orderId);
        if (
          !record ||
          (record.status !== "PAYMENT_APPROVED_FINALIZING" && record.status !== "CONFIRMED")
        ) {
          throw new Error(`Order payment finalization transition lost: ${entry.command.orderId}`);
        }
        await super.markCommandCompleted(commandId, claimToken, completedAt);
        if (record.status === "PAYMENT_APPROVED_FINALIZING") {
          record.status = "CONFIRMED";
          record.updatedAt = completedAt;
        }
        return;
      }
      return super.markCommandCompleted(commandId, claimToken, completedAt);
    }

    await super.markCommandCompleted(commandId, claimToken, completedAt);
    const record = this.records.get(entry.command.orderId);
    if (!record || record.status !== "RESERVING_INVENTORY") {
      throw new Error(`Order reservation transition lost: ${entry.command.orderId}`);
    }
    record.status = "AWAITING_PAYMENT_PROOF";
    record.updatedAt = completedAt;
  }

  public override async markCommandRejected(
    commandId: string,
    claimToken: string,
    reason: string,
    rejectedAt: Date,
    terminalOrderStatus: "RESERVATION_FAILED" | "RESERVATION_EXPIRED" = "RESERVATION_FAILED",
  ): Promise<void> {
    const entry = this.commands.get(commandId);
    if (!entry || entry.command.commandType !== "RESERVE") {
      return super.markCommandRejected(commandId, claimToken, reason, rejectedAt);
    }

    await super.markCommandRejected(commandId, claimToken, reason, rejectedAt);
    const record = this.records.get(entry.command.orderId);
    if (!record || record.status !== "RESERVING_INVENTORY") {
      throw new Error(`Order reservation transition lost: ${entry.command.orderId}`);
    }
    record.status = terminalOrderStatus;
    record.updatedAt = rejectedAt;
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

  public async approvePayment(
    orderId: string,
    adminCustomerId: string,
    decidedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<PaymentApprovalResult> {
    const record = this.records.get(orderId);
    if (!record) {
      return "not-found";
    }
    if (record.cancelRequestedAt && !record.cancelResolvedAt) {
      return "not-pending";
    }
    if (record.paymentDecision) {
      if (
        record.paymentDecision.decision === "APPROVED" &&
        (record.status === "PAYMENT_APPROVED_FINALIZING" || record.status === "CONFIRMED")
      ) {
        return "already-approved";
      }
      return "decision-conflict";
    }
    if (record.status !== "PAYMENT_REVIEW_PENDING") {
      return "not-pending";
    }

    this.add(inventoryCommand);
    record.paymentDecision = {
      decision: "APPROVED",
      decidedAt,
      reason: null,
    };
    record.status = "PAYMENT_APPROVED_FINALIZING";
    record.updatedAt = decidedAt;
    return "approved";
  }

  public async rejectPayment(
    orderId: string,
    adminCustomerId: string,
    reason: string,
    decidedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<PaymentRejectionResult> {
    const record = this.records.get(orderId);
    if (!record) {
      return "not-found";
    }
    if (record.cancelRequestedAt && !record.cancelResolvedAt) {
      return "not-pending";
    }
    if (record.paymentDecision) {
      if (
        record.paymentDecision.decision === "REJECTED" &&
        record.status === "CANCELLED"
      ) {
        return "already-rejected";
      }
      return "decision-conflict";
    }
    if (record.status !== "PAYMENT_REVIEW_PENDING") {
      return "not-pending";
    }

    this.add(inventoryCommand);
    record.paymentDecision = {
      decision: "REJECTED",
      decidedAt,
      reason,
    };
    record.status = "CANCELLED";
    record.updatedAt = decidedAt;
    return "rejected";
  }

  public async cancelOrder(
    orderId: string,
    customerId: string,
    cancelledAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<OrderCancellationResult> {
    const record = this.records.get(orderId);
    if (!record || record.customerId !== customerId) {
      return "not-found";
    }
    if (record.status === "CANCELLED" && record.paymentDecision === null) {
      return "already-cancelled";
    }
    if (
      record.status !== "AWAITING_PAYMENT_PROOF" ||
      record.paymentDecision !== null ||
      record.reservationExpiresAt === null ||
      record.reservationExpiresAt.getTime() <= cancelledAt.getTime()
    ) {
      return "not-cancellable";
    }

    this.add(inventoryCommand);
    record.status = "CANCELLED";
    record.updatedAt = cancelledAt;
    return "cancelled";
  }

  public async requestCancellation(
    orderId: string,
    customerId: string,
    requestedAt: Date,
  ): Promise<CancellationRequestResult> {
    const record = this.records.get(orderId);
    if (!record || record.customerId !== customerId) {
      return "not-found";
    }
    if (record.cancelRequestedAt) {
      return record.cancelResolvedAt ? "already-resolved" : "already-pending";
    }
    if (record.status !== "PAYMENT_REVIEW_PENDING" || record.paymentDecision !== null) {
      return "not-eligible";
    }
    record.cancelRequestedAt = requestedAt;
    record.updatedAt = requestedAt;
    return "requested";
  }

  public async listPendingCancellationRequests(): Promise<PendingCancellationRequest[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.status === "PAYMENT_REVIEW_PENDING" &&
          record.cancelRequestedAt !== null &&
          record.cancelResolvedAt === null,
      )
      .map((record) => ({
        orderId: record.orderId,
        customerId: record.customerId,
        totalCop: record.totalCop,
        createdAt: record.createdAt.toISOString(),
        requestedAt: record.cancelRequestedAt!.toISOString(),
        paymentCaptured: record.cancelPaymentCaptured,
        refundHandledAt: record.externalRefundHandledAt?.toISOString() ?? null,
        externalRefundReference: record.externalRefundReference,
        refundRecordedByCustomerId: record.externalRefundRecordedByCustomerId,
      }))
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }

  public async recordCancellationRefund(
    orderId: string,
    adminCustomerId: string,
    paymentCaptured: boolean,
    externalRefundReference: string | null,
    recordedAt: Date,
  ): Promise<CancellationRefundRecordResult> {
    const record = this.records.get(orderId);
    if (!record) {
      return "not-found";
    }
    if (
      record.status !== "PAYMENT_REVIEW_PENDING" ||
      !record.cancelRequestedAt ||
      record.cancelResolvedAt
    ) {
      return "not-pending";
    }
    if (record.cancelPaymentCaptured !== null) {
      return record.cancelPaymentCaptured === paymentCaptured &&
        record.externalRefundReference === externalRefundReference
        ? "already-recorded"
        : "conflict";
    }

    record.cancelPaymentCaptured = paymentCaptured;
    record.externalRefundRecordedByCustomerId = adminCustomerId;
    record.externalRefundReference = externalRefundReference;
    record.externalRefundHandledAt = paymentCaptured ? recordedAt : null;
    record.updatedAt = recordedAt;
    return "recorded";
  }

  public async resolveCancellationRequest(
    orderId: string,
    adminCustomerId: string,
    action: CancellationResolutionAction,
    note: string,
    resolvedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<CancellationResolutionResult> {
    const record = this.records.get(orderId);
    if (!record) {
      return "not-found";
    }
    if (record.cancelRequestedAt && record.cancelResolvedAt) {
      return "already-resolved";
    }
    if (
      record.status !== "PAYMENT_REVIEW_PENDING" ||
      !record.cancelRequestedAt ||
      record.paymentDecision !== null
    ) {
      return "not-pending";
    }
    if (action === "CANCEL") {
      if (record.cancelPaymentCaptured === null) {
        return "refund-not-recorded";
      }
      if (
        record.cancelPaymentCaptured &&
        (!record.externalRefundHandledAt || !record.externalRefundReference)
      ) {
        return "refund-not-recorded";
      }
      this.add(inventoryCommand);
      record.status = "CANCELLED";
    }
    record.cancelResolvedAt = resolvedAt;
    record.cancelResolution = action === "CANCEL" ? "CANCELLED" : "KEPT_OPEN";
    record.cancelResolvedByCustomerId = adminCustomerId;
    record.cancelResolutionNote = note;
    record.updatedAt = resolvedAt;
    return action === "CANCEL" ? "cancelled" : "kept-open";
  }

  public async expireDueOrders(now: Date, limit: number): Promise<number> {
    let expiredCount = 0;
    for (const record of this.records.values()) {
      if (expiredCount >= limit) {
        break;
      }
      if (
        record.status !== "AWAITING_PAYMENT_PROOF" ||
        record.paymentDecision !== null ||
        record.reservationExpiresAt === null ||
        record.reservationExpiresAt.getTime() > now.getTime()
      ) {
        continue;
      }

      this.add(createInventoryReleaseCommand(record.orderId));
      record.status = "RESERVATION_EXPIRED";
      record.updatedAt = now;
      expiredCount += 1;
    }
    return expiredCount;
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
