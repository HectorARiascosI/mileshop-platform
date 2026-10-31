import { Prisma, type PrismaClient } from "../generated/orders-client/index.js";

import {
  parseOrderCancellationResolution,
  type OrderRecord,
} from "./orders.domain.js";
import {
  type ClaimedOrderEvent,
  type CancellationRefundRecordResult,
  type CancellationResolutionAction,
  type CancellationResolutionResult,
  type CancellationRequestResult,
  type OrdersRepository,
  type OutboxFailureResult,
  type OrderCancellationResult,
  type PaymentApprovalResult,
  type PaymentRejectionResult,
} from "./orders.repository.js";
import {
  type ClaimedInventoryCommand,
  createInventoryReleaseCommand,
  type InventoryCommand,
  type InventoryCommandFailureResult,
  type InventoryCommandRepository,
} from "./inventory-command.repository.js";
import type { OrderCreatedEvent, PendingCancellationRequest } from "./orders.types.js";
import { paymentEvidenceRetentionDeadline } from "./payment-evidence/payment-evidence-retention.js";

const OUTBOX_MAX_ATTEMPTS = 8;

function retryDelayMs(attemptCount: number): number {
  return Math.min(5_000 * 2 ** (attemptCount - 1), 300_000);
}

function parseCommandPayload(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Inventory command payload must be a JSON object");
  }
  const payload: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    payload[key] = entry;
  }
  return payload;
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
  reservationExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelResolvedAt: Date | null;
  cancelResolution: string | null;
  cancelResolvedByCustomerId: string | null;
  cancelResolutionNote: string | null;
  cancelPaymentCaptured: boolean | null;
  externalRefundRecordedByCustomerId: string | null;
  externalRefundReference: string | null;
  externalRefundHandledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  paymentDecision: {
    decision: "APPROVED" | "REJECTED";
    decidedAt: Date;
    reason: string | null;
  } | null;
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
    reservationExpiresAt: row.reservationExpiresAt,
    cancelRequestedAt: row.cancelRequestedAt,
    cancelResolvedAt: row.cancelResolvedAt,
    cancelResolution: parseOrderCancellationResolution(row.cancelResolution),
    cancelResolvedByCustomerId: row.cancelResolvedByCustomerId,
    cancelResolutionNote: row.cancelResolutionNote,
    cancelPaymentCaptured: row.cancelPaymentCaptured,
    externalRefundRecordedByCustomerId: row.externalRefundRecordedByCustomerId,
    externalRefundReference: row.externalRefundReference,
    externalRefundHandledAt: row.externalRefundHandledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paymentDecision: row.paymentDecision,
    lines: row.lines.map((line) => ({ ...line })),
  };
}

export class PrismaOrdersRepository implements OrdersRepository, InventoryCommandRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async save(
    record: OrderRecord,
    event: OrderCreatedEvent,
    inventoryCommand: InventoryCommand,
  ): Promise<void> {
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
          reservationExpiresAt: record.reservationExpiresAt,
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

      await transaction.inventoryCommandOutbox.create({
        data: {
          commandId: inventoryCommand.commandId,
          idempotencyKey: inventoryCommand.idempotencyKey,
          orderId: inventoryCommand.orderId,
          commandType: inventoryCommand.commandType,
          payload: JSON.parse(JSON.stringify(inventoryCommand.payload)) as Prisma.InputJsonValue,
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
      include: {
        lines: true,
        paymentDecision: {
          select: { decision: true, decidedAt: true, reason: true },
        },
      },
    });

    return row ? mapOrderRecord(row) : null;
  }

  public async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      include: {
        lines: true,
        paymentDecision: {
          select: { decision: true, decidedAt: true, reason: true },
        },
      },
    });

    return row ? mapOrderRecord(row) : null;
  }

  public async approvePayment(
    orderId: string,
    adminCustomerId: string,
    decidedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<PaymentApprovalResult> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          OR: [
            { cancelRequestedAt: null },
            { cancelResolvedAt: { not: null } },
          ],
          paymentEvidence: { isNot: null },
        },
        data: {
          status: "PAYMENT_APPROVED_FINALIZING",
          updatedAt: decidedAt,
        },
      });

      if (transition.count !== 1) {
        const current = await transaction.order.findUnique({
          where: { orderId },
          select: {
            status: true,
            paymentDecision: { select: { decision: true } },
          },
        });
        if (!current) {
          return "not-found";
        }
        if (current.paymentDecision?.decision === "APPROVED") {
          if (
            current.status === "PAYMENT_APPROVED_FINALIZING" ||
            current.status === "CONFIRMED"
          ) {
            return "already-approved";
          }
          return "decision-conflict";
        }
        if (current.paymentDecision) {
          return "decision-conflict";
        }
        return "not-pending";
      }

      await transaction.paymentDecision.create({
        data: {
          orderId,
          decision: "APPROVED",
          adminCustomerId,
          decidedAt,
          reason: null,
        },
      });
      await transaction.inventoryCommandOutbox.create({
        data: {
          commandId: inventoryCommand.commandId,
          idempotencyKey: inventoryCommand.idempotencyKey,
          orderId: inventoryCommand.orderId,
          commandType: inventoryCommand.commandType,
          payload: JSON.parse(JSON.stringify(inventoryCommand.payload)) as Prisma.InputJsonValue,
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: decidedAt,
        },
      });
      return "approved";
    });
  }

  public async rejectPayment(
    orderId: string,
    adminCustomerId: string,
    reason: string,
    decidedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<PaymentRejectionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { isNot: null },
          OR: [
            { cancelRequestedAt: null },
            { cancelResolvedAt: { not: null } },
          ],
        },
        data: {
          status: "CANCELLED",
          updatedAt: decidedAt,
        },
      });

      if (transition.count !== 1) {
        const current = await transaction.order.findUnique({
          where: { orderId },
          select: {
            status: true,
            paymentDecision: { select: { decision: true } },
          },
        });
        if (!current) {
          return "not-found";
        }
        if (current.paymentDecision?.decision === "REJECTED") {
          return current.status === "CANCELLED" ? "already-rejected" : "decision-conflict";
        }
        if (current.paymentDecision) {
          return "decision-conflict";
        }
        return "not-pending";
      }

      await transaction.paymentDecision.create({
        data: {
          orderId,
          decision: "REJECTED",
          adminCustomerId,
          decidedAt,
          reason,
        },
      });
      await transaction.paymentEvidence.updateMany({
        where: { orderId, retentionUntil: null, deletedAt: null },
        data: { retentionUntil: paymentEvidenceRetentionDeadline(decidedAt) },
      });
      await transaction.inventoryCommandOutbox.create({
        data: {
          commandId: inventoryCommand.commandId,
          idempotencyKey: inventoryCommand.idempotencyKey,
          orderId: inventoryCommand.orderId,
          commandType: inventoryCommand.commandType,
          payload: JSON.parse(JSON.stringify(inventoryCommand.payload)) as Prisma.InputJsonValue,
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: decidedAt,
        },
      });
      return "rejected";
    });
  }

  public async cancelOrder(
    orderId: string,
    customerId: string,
    cancelledAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<OrderCancellationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.order.updateMany({
        where: {
          orderId,
          customerId,
          status: "AWAITING_PAYMENT_PROOF",
          reservationExpiresAt: { gt: cancelledAt },
          paymentDecision: { is: null },
          paymentEvidence: { is: null },
        },
        data: {
          status: "CANCELLED",
          updatedAt: cancelledAt,
        },
      });

      if (transition.count !== 1) {
        const current = await transaction.order.findFirst({
          where: { orderId, customerId },
          select: {
            status: true,
            paymentDecision: { select: { decision: true } },
          },
        });
        if (!current) {
          return "not-found";
        }
        if (current.status === "CANCELLED" && !current.paymentDecision) {
          return "already-cancelled";
        }
        return "not-cancellable";
      }

      await transaction.inventoryCommandOutbox.create({
        data: {
          commandId: inventoryCommand.commandId,
          idempotencyKey: inventoryCommand.idempotencyKey,
          orderId: inventoryCommand.orderId,
          commandType: inventoryCommand.commandType,
          payload: JSON.parse(JSON.stringify(inventoryCommand.payload)) as Prisma.InputJsonValue,
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: cancelledAt,
        },
      });
      return "cancelled";
    });
  }

  public async requestCancellation(
    orderId: string,
    customerId: string,
    requestedAt: Date,
  ): Promise<CancellationRequestResult> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.order.updateMany({
        where: {
          orderId,
          customerId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { is: { deletedAt: null } },
          cancelRequestedAt: null,
        },
        data: {
          cancelRequestedAt: requestedAt,
          updatedAt: requestedAt,
        },
      });
      if (transition.count === 1) {
        return "requested";
      }

      const current = await transaction.order.findFirst({
        where: { orderId, customerId },
        select: {
          status: true,
          cancelRequestedAt: true,
          cancelResolvedAt: true,
          paymentDecision: { select: { decision: true } },
        },
      });
      if (!current) {
        return "not-found";
      }
      if (current.cancelRequestedAt) {
        return current.cancelResolvedAt ? "already-resolved" : "already-pending";
      }
      return "not-eligible";
    });
  }

  public async listPendingCancellationRequests(): Promise<PendingCancellationRequest[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: "PAYMENT_REVIEW_PENDING",
        cancelRequestedAt: { not: null },
        cancelResolvedAt: null,
        paymentDecision: { is: null },
      },
      orderBy: [{ cancelRequestedAt: "asc" }, { orderId: "asc" }],
      select: {
        orderId: true,
        customerId: true,
        totalCop: true,
        createdAt: true,
        cancelRequestedAt: true,
        cancelPaymentCaptured: true,
        externalRefundHandledAt: true,
        externalRefundReference: true,
        externalRefundRecordedByCustomerId: true,
      },
    });
    return orders.flatMap((order) =>
      order.cancelRequestedAt
        ? [{
            orderId: order.orderId,
            customerId: order.customerId,
            totalCop: order.totalCop,
            createdAt: order.createdAt.toISOString(),
            requestedAt: order.cancelRequestedAt.toISOString(),
            paymentCaptured: order.cancelPaymentCaptured,
            refundHandledAt: order.externalRefundHandledAt?.toISOString() ?? null,
            externalRefundReference: order.externalRefundReference,
            refundRecordedByCustomerId: order.externalRefundRecordedByCustomerId,
          }]
        : [],
    );
  }

  public async recordCancellationRefund(
    orderId: string,
    adminCustomerId: string,
    paymentCaptured: boolean,
    externalRefundReference: string | null,
    recordedAt: Date,
  ): Promise<CancellationRefundRecordResult> {
    return this.prisma.$transaction(async (transaction) => {
      const transition = await transaction.order.updateMany({
        where: {
          orderId,
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          cancelRequestedAt: { not: null },
          cancelResolvedAt: null,
          cancelPaymentCaptured: null,
        },
        data: {
          cancelPaymentCaptured: paymentCaptured,
          externalRefundRecordedByCustomerId: adminCustomerId,
          externalRefundReference,
          externalRefundHandledAt: paymentCaptured ? recordedAt : null,
          updatedAt: recordedAt,
        },
      });
      if (transition.count === 1) {
        return "recorded";
      }

      const current = await transaction.order.findUnique({
        where: { orderId },
        select: {
          status: true,
          cancelRequestedAt: true,
          cancelResolvedAt: true,
          cancelPaymentCaptured: true,
          externalRefundReference: true,
        },
      });
      if (!current) {
        return "not-found";
      }
      if (
        current.status !== "PAYMENT_REVIEW_PENDING" ||
        !current.cancelRequestedAt ||
        current.cancelResolvedAt
      ) {
        return "not-pending";
      }
      return current.cancelPaymentCaptured === paymentCaptured &&
        current.externalRefundReference === externalRefundReference
        ? "already-recorded"
        : "conflict";
    });
  }

  public async resolveCancellationRequest(
    orderId: string,
    adminCustomerId: string,
    action: CancellationResolutionAction,
    note: string,
    resolvedAt: Date,
    inventoryCommand: InventoryCommand,
  ): Promise<CancellationResolutionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const where: Prisma.OrderWhereInput = {
        orderId,
        status: "PAYMENT_REVIEW_PENDING",
        paymentDecision: { is: null },
        cancelRequestedAt: { not: null },
        cancelResolvedAt: null,
      };
      if (action === "CANCEL") {
        where.OR = [
          { cancelPaymentCaptured: false },
          {
            cancelPaymentCaptured: true,
            externalRefundHandledAt: { not: null },
            externalRefundReference: { not: null },
          },
        ];
      }
      const transition = await transaction.order.updateMany({
        where,
        data: {
          ...(action === "CANCEL" ? { status: "CANCELLED" } : {}),
          cancelResolvedAt: resolvedAt,
          cancelResolution: action === "CANCEL" ? "CANCELLED" : "KEPT_OPEN",
          cancelResolvedByCustomerId: adminCustomerId,
          cancelResolutionNote: note,
          updatedAt: resolvedAt,
        },
      });
      if (transition.count !== 1) {
        const current = await transaction.order.findUnique({
          where: { orderId },
          select: {
            status: true,
            cancelRequestedAt: true,
            cancelResolvedAt: true,
            cancelPaymentCaptured: true,
            externalRefundHandledAt: true,
            externalRefundReference: true,
          },
        });
        if (!current) {
          return "not-found";
        }
        if (current.cancelRequestedAt && current.cancelResolvedAt) {
          return "already-resolved";
        }
        if (
          current.status !== "PAYMENT_REVIEW_PENDING" ||
          !current.cancelRequestedAt
        ) {
          return "not-pending";
        }
        if (
          action === "CANCEL" &&
          (current.cancelPaymentCaptured === null ||
            (current.cancelPaymentCaptured &&
              (!current.externalRefundHandledAt || !current.externalRefundReference)))
        ) {
          return "refund-not-recorded";
        }
        return "not-pending";
      }
      if (action === "CANCEL") {
        await transaction.paymentEvidence.updateMany({
          where: { orderId, retentionUntil: null, deletedAt: null },
          data: { retentionUntil: paymentEvidenceRetentionDeadline(resolvedAt) },
        });
        await transaction.inventoryCommandOutbox.create({
          data: {
            commandId: inventoryCommand.commandId,
            idempotencyKey: inventoryCommand.idempotencyKey,
            orderId: inventoryCommand.orderId,
            commandType: inventoryCommand.commandType,
            payload: JSON.parse(JSON.stringify(inventoryCommand.payload)) as Prisma.InputJsonValue,
            status: "PENDING",
            attemptCount: 0,
            nextAttemptAt: resolvedAt,
          },
        });
      }
      return action === "CANCEL" ? "cancelled" : "kept-open";
    });
  }

  public async expireDueOrders(now: Date, limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Order expiry batch size must be a positive safe integer");
    }

    const candidates = await this.prisma.order.findMany({
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

    let expiredCount = 0;
    for (const candidate of candidates) {
      const expired = await this.prisma.$transaction(async (transaction) => {
        const transition = await transaction.order.updateMany({
          where: {
            orderId: candidate.orderId,
            status: "AWAITING_PAYMENT_PROOF",
            reservationExpiresAt: { lte: now },
            paymentDecision: { is: null },
            paymentEvidence: { is: null },
          },
          data: {
            status: "RESERVATION_EXPIRED",
            updatedAt: now,
          },
        });
        if (transition.count !== 1) {
          return false;
        }

        const releaseCommand = createInventoryReleaseCommand(candidate.orderId);
        await transaction.inventoryCommandOutbox.create({
          data: {
            commandId: releaseCommand.commandId,
            idempotencyKey: releaseCommand.idempotencyKey,
            orderId: releaseCommand.orderId,
            commandType: releaseCommand.commandType,
            payload: JSON.parse(JSON.stringify(releaseCommand.payload)) as Prisma.InputJsonValue,
            status: "PENDING",
            attemptCount: 0,
            nextAttemptAt: now,
          },
        });
        return true;
      });
      if (expired) {
        expiredCount += 1;
      }
    }

    return expiredCount;
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

  public async claimPendingCommands(
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<ClaimedInventoryCommand[]> {
    await this.prisma.inventoryCommandOutbox.updateMany({
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

    const candidates = await this.prisma.inventoryCommandOutbox.findMany({
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

    const claims: ClaimedInventoryCommand[] = [];
    for (const candidate of candidates) {
      const claimToken = crypto.randomUUID();
      const claimed = await this.prisma.inventoryCommandOutbox.updateMany({
        where: {
          commandId: candidate.commandId,
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
        command: {
          commandId: candidate.commandId,
          idempotencyKey: candidate.idempotencyKey,
          orderId: candidate.orderId,
          commandType: candidate.commandType,
          payload: parseCommandPayload(candidate.payload),
        },
        attemptCount: candidate.attemptCount + 1,
        claimToken,
      });
    }

    return claims;
  }

  public async markCommandCompleted(
    commandId: string,
    claimToken: string,
    completedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const command = await transaction.inventoryCommandOutbox.findFirst({
        where: { commandId, status: "PROCESSING", claimToken },
        select: { commandType: true, orderId: true },
      });
      if (!command) {
        throw new Error(`Inventory command claim lost: ${commandId}`);
      }

      if (command.commandType === "RESERVE") {
        const transition = await transaction.order.updateMany({
          where: { orderId: command.orderId, status: "RESERVING_INVENTORY" },
          data: { status: "AWAITING_PAYMENT_PROOF", updatedAt: completedAt },
        });
        if (transition.count !== 1) {
          throw new Error(`Order reservation transition lost: ${command.orderId}`);
        }
      }
      if (command.commandType === "COMMIT") {
        const transition = await transaction.order.updateMany({
          where: { orderId: command.orderId, status: "PAYMENT_APPROVED_FINALIZING" },
          data: { status: "CONFIRMED", updatedAt: completedAt },
        });
        if (transition.count !== 1) {
          const current = await transaction.order.findUnique({
            where: { orderId: command.orderId },
            select: { status: true },
          });
          if (current?.status !== "CONFIRMED") {
            throw new Error(`Order payment finalization transition lost: ${command.orderId}`);
          }
        }
        await transaction.paymentEvidence.updateMany({
          where: {
            orderId: command.orderId,
            retentionUntil: null,
            deletedAt: null,
          },
          data: { retentionUntil: paymentEvidenceRetentionDeadline(completedAt) },
        });
      }

      const result = await transaction.inventoryCommandOutbox.updateMany({
        where: { commandId, status: "PROCESSING", claimToken },
        data: {
          status: "COMPLETED",
          claimToken: null,
          leaseExpiresAt: null,
          lastError: null,
          completedAt,
        },
      });
      if (result.count !== 1) {
        throw new Error(`Inventory command claim lost: ${commandId}`);
      }
    });
  }

  public async markCommandRejected(
    commandId: string,
    claimToken: string,
    reason: string,
    rejectedAt: Date,
    terminalOrderStatus: "RESERVATION_FAILED" | "RESERVATION_EXPIRED" = "RESERVATION_FAILED",
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const command = await transaction.inventoryCommandOutbox.findFirst({
        where: { commandId, status: "PROCESSING", claimToken },
        select: { commandType: true, orderId: true },
      });
      if (!command) {
        throw new Error(`Inventory command claim lost: ${commandId}`);
      }

      if (command.commandType === "RESERVE") {
        const transition = await transaction.order.updateMany({
          where: { orderId: command.orderId, status: "RESERVING_INVENTORY" },
          data: { status: terminalOrderStatus, updatedAt: rejectedAt },
        });
        if (transition.count !== 1) {
          throw new Error(`Order reservation transition lost: ${command.orderId}`);
        }
      }

      const result = await transaction.inventoryCommandOutbox.updateMany({
        where: { commandId, status: "PROCESSING", claimToken },
        data: {
          status: "FAILED",
          claimToken: null,
          leaseExpiresAt: null,
          lastError: reason.slice(0, 1000),
        },
      });
      if (result.count !== 1) {
        throw new Error(`Inventory command claim lost: ${commandId}`);
      }
    });
  }

  public async markCommandFailed(
    commandId: string,
    claimToken: string,
    reason: string,
    failedAt: Date,
  ): Promise<InventoryCommandFailureResult> {
    const current = await this.prisma.inventoryCommandOutbox.findFirst({
      where: { commandId, status: "PROCESSING", claimToken },
      select: { attemptCount: true },
    });
    if (!current) {
      throw new Error(`Inventory command claim lost: ${commandId}`);
    }

    const nextAttemptAt = current.attemptCount >= OUTBOX_MAX_ATTEMPTS
      ? null
      : new Date(failedAt.getTime() + retryDelayMs(current.attemptCount));
    const result = await this.prisma.inventoryCommandOutbox.updateMany({
      where: {
        commandId,
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
      throw new Error(`Inventory command claim lost: ${commandId}`);
    }
    return { attemptCount: current.attemptCount, nextAttemptAt };
  }
}
