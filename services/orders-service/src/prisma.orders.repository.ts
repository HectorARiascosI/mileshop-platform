import type { PrismaClient } from "../generated/orders-client/index.js";

import type { OrderRecord } from "./orders.domain.js";
import type { OrdersRepository } from "./orders.repository.js";
import type { ReservationIntent } from "./orders.repository.js";
import type { OrderCreatedEvent } from "./orders.types.js";
import type { InventoryCommand } from "./inventory-command.repository.js";

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
    record.status = "AWAITING_PAYMENT_PROOF";
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
    const due = await this.prisma.order.findMany({
      where: {
        status: "AWAITING_PAYMENT_PROOF",
        reservationExpiresAt: { lte: now },
        paymentDecision: { is: null },
        paymentEvidence: { is: null },
      },
      orderBy: [{ reservationExpiresAt: "asc" }, { orderId: "asc" }],
      take: limit,
      select: { orderId: true },
    });
    let expired = 0;
    for (const row of due) {
      const transitioned = await this.prisma.$transaction(async (transaction) => {
        const result = await transaction.order.updateMany({
          where: {
            orderId: row.orderId,
            status: "AWAITING_PAYMENT_PROOF",
            reservationExpiresAt: { lte: now },
            paymentDecision: { is: null },
            paymentEvidence: { is: null },
          },
          data: { status: "RESERVATION_EXPIRED", updatedAt: now },
        });
        if (result.count !== 1) return false;
        await this.createCommand(transaction, {
          commandId: `${row.orderId}-release-inventory`,
          idempotencyKey: `${row.orderId}:RELEASE`,
          orderId: row.orderId,
          commandType: "RELEASE",
          payload: {},
        }, now);
        return true;
      });
      if (transitioned) expired += 1;
    }
    return expired;
  }

  public async approvePayment(
    orderId: string,
    adminCustomerId: string,
    decidedAt: Date,
    command: InventoryCommand,
  ): Promise<"approved" | "already-approved" | "decision-conflict" | "not-pending" | "cancel-requested"> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { isNot: null },
          OR: [{ cancelRequestedAt: null }, { cancelResolvedAt: { not: null } }],
        },
        data: { status: "PAYMENT_APPROVED_FINALIZING", updatedAt: decidedAt },
      });
      if (updated.count !== 1) {
        const current = await transaction.order.findUnique({
          where: { orderId },
          include: { paymentDecision: true },
        });
        if (current?.paymentDecision?.decision === "APPROVED") return "already-approved";
        if (current?.paymentDecision) return "decision-conflict";
        return "not-pending";
      }

      await transaction.paymentDecision.create({
        data: { orderId, decision: "APPROVED", adminCustomerId, decidedAt, reason: null },
      });
      await this.createCommand(transaction, command, decidedAt);
      return "approved";
    });
  }

  public async rejectPayment(
    orderId: string,
    adminCustomerId: string,
    reason: string,
    decidedAt: Date,
    command: InventoryCommand,
  ): Promise<"rejected" | "already-rejected" | "decision-conflict" | "not-pending" | "cancel-requested"> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { isNot: null },
          OR: [{ cancelRequestedAt: null }, { cancelResolvedAt: { not: null } }],
        },
        data: { status: "CANCELLED", updatedAt: decidedAt },
      });
      if (updated.count !== 1) {
        const current = await transaction.order.findUnique({
          where: { orderId },
          include: { paymentDecision: true },
        });
        if (current?.paymentDecision?.decision === "REJECTED") return "already-rejected";
        if (current?.paymentDecision) return "decision-conflict";
        return "not-pending";
      }

      await transaction.paymentDecision.create({
        data: { orderId, decision: "REJECTED", adminCustomerId, decidedAt, reason },
      });
      await transaction.paymentEvidence.updateMany({
        where: { orderId, retentionUntil: null, deletedAt: null },
        data: { retentionUntil: new Date(decidedAt.getTime() + 365 * 24 * 60 * 60 * 1000) },
      });
      await this.createCommand(transaction, command, decidedAt);
      return "rejected";
    });
  }

  public async markCommandCompleted(
    commandId: string,
    claimToken: string,
    completedAt: Date,
  ): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      const command = await transaction.inventoryCommandOutbox.findFirst({
        where: { commandId, status: "PROCESSING", claimToken },
        select: { commandType: true, orderId: true },
      });
      if (!command) return;
      const updated = await transaction.order.updateMany({
        where: { orderId: command.orderId, status: "PAYMENT_APPROVED_FINALIZING" },
        data: { status: "CONFIRMED", updatedAt: completedAt },
      });
      if (updated.count !== 1) return;
      await transaction.paymentEvidence.updateMany({
        where: { orderId: command.orderId, retentionUntil: null, deletedAt: null },
        data: { retentionUntil: new Date(completedAt.getTime() + 365 * 24 * 60 * 60 * 1000) },
      });
      const claimed = await transaction.inventoryCommandOutbox.updateMany({
        where: { commandId, status: "PROCESSING", claimToken },
        data: { status: "COMPLETED", claimToken: null, leaseExpiresAt: null, lastError: null, completedAt },
      });
      if (claimed.count !== 1) return;
    });
  }

  public async requestCancellation(
    orderId: string,
    customerId: string,
    requestedAt: Date,
  ): Promise<"requested" | "not-pending-proof" | "not-owner" | "already-resolved" | "already-requested"> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.order.updateMany({
        where: {
          orderId,
          customerId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { is: { deletedAt: null } },
          cancelRequestedAt: null,
        },
        data: { cancelRequestedAt: requestedAt, updatedAt: requestedAt },
      });
      return updated.count === 1 ? "requested" : "not-pending-proof";
    });
  }

  public async recordCancellationRefund(
    orderId: string,
    adminCustomerId: string,
    paymentCaptured: boolean,
    refundReference: string | null,
    recordedAt: Date,
  ): Promise<"recorded" | "not-pending"> {
    const data: Record<string, unknown> = {
      cancelPaymentCaptured: paymentCaptured,
      updatedAt: recordedAt,
    };
    if (paymentCaptured) {
      Object.assign(data, {
        externalRefundRecordedByCustomerId: adminCustomerId,
        externalRefundReference: refundReference,
        externalRefundHandledAt: recordedAt,
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          cancelRequestedAt: { not: null },
          cancelResolvedAt: null,
          cancelPaymentCaptured: null,
        },
        data,
      });
      return result.count === 1 ? "recorded" : "not-pending";
    });
  }

  public async resolveCancellationRequest(
    orderId: string,
    adminCustomerId: string,
    resolution: "CANCEL" | "KEEP",
    note: string | null,
    resolvedAt: Date,
    command?: InventoryCommand,
  ): Promise<"cancelled" | "kept" | "refund-required" | "refund-not-recorded" | "not-pending"> {
    return this.prisma.$transaction(async (transaction) => {
      if (resolution === "KEEP") {
        const result = await transaction.order.updateMany({
          where: { orderId, status: "PAYMENT_REVIEW_PENDING", cancelRequestedAt: { not: null }, cancelResolvedAt: null },
          data: { cancelResolvedAt: resolvedAt, cancelResolution: "KEEP", cancelResolvedByCustomerId: adminCustomerId, cancelResolutionNote: note, updatedAt: resolvedAt },
        });
        return result.count === 1 ? "kept" : "not-pending";
      }
      const result = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          cancelRequestedAt: { not: null },
          cancelResolvedAt: null,
          OR: [
            { cancelPaymentCaptured: false },
            { cancelPaymentCaptured: true, externalRefundHandledAt: { not: null }, externalRefundReference: { not: null } },
          ],
        },
        data: { status: "CANCELLED", cancelResolvedAt: resolvedAt, cancelResolution: "CANCELLED", cancelResolvedByCustomerId: adminCustomerId, cancelResolutionNote: note, updatedAt: resolvedAt },
      });
      if (result.count !== 1) {
        const current = await transaction.order.findUnique({
          where: { orderId, cancelRequestedAt: { not: null }, cancelResolvedAt: null },
          select: { cancelPaymentCaptured: true },
        });
        return current?.cancelPaymentCaptured === null ? "refund-not-recorded" : "not-pending";
      }
      await transaction.paymentEvidence.updateMany({
        where: { orderId, retentionUntil: null, deletedAt: null },
        data: { retentionUntil: new Date(resolvedAt.getTime() + 365 * 24 * 60 * 60 * 1000) },
      });
      if (command) await this.createCommand(transaction, command, resolvedAt);
      return "cancelled";
    });
  }

  public async cancelOrder(
    orderId: string,
    customerId: string,
    cancelledAt: Date,
    command: InventoryCommand,
  ): Promise<"cancelled" | "already-cancelled" | "not-cancellable" | "not-owner" | "not-found" | "not-active"> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.order.updateMany({
        where: {
          orderId,
          customerId,
          status: "AWAITING_PAYMENT_PROOF",
          reservationExpiresAt: { gt: cancelledAt },
          paymentDecision: { is: null },
          paymentEvidence: { is: null },
        },
        data: { status: "CANCELLED", updatedAt: cancelledAt },
      });
      if (result.count !== 1) {
        if (!(transaction.order as { findFirst?: unknown }).findFirst && !(transaction.order as { findUnique?: unknown }).findUnique) {
          return "not-active";
        }
        const current = await transaction.order.findFirst({
          where: { orderId },
          select: { status: true, customerId: true, paymentDecision: true },
        });
        if (!current) return "not-found";
        if (current?.status === "CANCELLED") return "already-cancelled";
        return current?.customerId !== customerId ? "not-owner" : "not-cancellable";
      }
      await this.createCommand(transaction, command, cancelledAt);
      return "cancelled";
    });
  }

  private async createCommand(transaction: any, command: InventoryCommand, nextAttemptAt: Date): Promise<void> {
    await transaction.inventoryCommandOutbox.create({
      data: {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        orderId: command.orderId,
        commandType: command.commandType,
        payload: command.payload,
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt,
      },
    });
  }
}
