import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/orders-client/index.js";
import {
  OrderDomain,
  parseOrderCancellationResolution,
} from "../orders.domain.js";
import type { OrderRecord } from "../orders.domain.js";

import type {
  PaymentEvidenceActor,
  PaymentEvidenceInput,
  PaymentEvidenceMetadata,
  PaymentEvidenceReviewRecord,
  PaymentEvidenceRepository,
  PaymentEvidenceCleanupClaim,
  PaymentEvidenceLegalHoldResult,
  PaymentEvidenceSaveResult,
  PaymentEvidenceAdminDeleteClaimResult,
} from "./payment-evidence.repository.js";

type PaymentReviewRow = {
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
  lines: OrderRecord["lines"];
  paymentEvidence: (Omit<PaymentEvidenceMetadata, "storageKey" | "originalFileName" | "contentType"> & {
    storageKey: string | null;
    originalFileName: string | null;
    contentType: string | null;
    deletedAt: Date | null;
    deletionReason: string | null;
  }) | null;
};

function mapPaymentReview(row: PaymentReviewRow): PaymentEvidenceReviewRecord {
  const evidence = row.paymentEvidence;
  if (
    !evidence ||
    typeof evidence.originalFileName !== "string" ||
    typeof evidence.contentType !== "string"
  ) {
    throw new Error(`Pending payment order ${row.orderId} has invalid payment evidence metadata`);
  }
  const { paymentEvidence: _evidence, ...order } = row;
  return {
    order: OrderDomain.toOrderView({
      ...order,
      cancelResolution: parseOrderCancellationResolution(order.cancelResolution),
      status: order.status as OrderRecord["status"],
    }),
    evidence: {
      id: evidence.id,
      orderId: evidence.orderId,
      storageKey: evidence.storageKey,
      deletedAt: evidence.deletedAt,
      deletionReason: evidence.deletionReason,
      originalFileName: evidence.originalFileName,
      contentType: evidence.contentType,
      sizeBytes: evidence.sizeBytes,
      transactionReference: evidence.transactionReference,
      receivedAt: evidence.receivedAt,
    },
  };
}

export class PrismaPaymentEvidenceRepository implements PaymentEvidenceRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findOrder(
    orderId: string,
  ): Promise<{
    customerId: string;
    status: string;
    reservationExpiresAt: Date | null;
  } | null> {
    return this.prisma.order.findUnique({
      where: { orderId },
      select: { customerId: true, status: true, reservationExpiresAt: true },
    });
  }

  public async createForActor(
    orderId: string,
    actor: PaymentEvidenceActor,
    evidence: PaymentEvidenceInput,
  ): Promise<PaymentEvidenceSaveResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const order = await transaction.order.findUnique({
          where: { orderId },
          select: { customerId: true, status: true, reservationExpiresAt: true },
        });
        if (!order) {
          return "not-found";
        }
        if (actor.role !== "CUSTOMER" || order.customerId !== actor.customerId) {
          return "forbidden";
        }
        if (
          order.reservationExpiresAt === null ||
          order.reservationExpiresAt.getTime() <= evidence.receivedAt.getTime()
        ) {
          return "expired";
        }
        if (order.status !== "AWAITING_PAYMENT_PROOF") {
          return "not-ready";
        }
        const existing = await transaction.paymentEvidence.findUnique({
          where: { orderId },
          select: { id: true },
        });
        if (existing) {
          return "exists";
        }

        const transition = await transaction.order.updateMany({
          where: {
            orderId,
            customerId: actor.customerId,
            status: "AWAITING_PAYMENT_PROOF",
            reservationExpiresAt: { gt: evidence.receivedAt },
          },
          data: {
            status: "PAYMENT_REVIEW_PENDING",
            updatedAt: evidence.receivedAt,
          },
        });
        if (transition.count !== 1) {
          const currentOrder = await transaction.order.findUnique({
            where: { orderId },
            select: { status: true, reservationExpiresAt: true },
          });
          if (!currentOrder) {
            return "not-found";
          }
          if (
            currentOrder.reservationExpiresAt === null ||
            currentOrder.reservationExpiresAt.getTime() <= evidence.receivedAt.getTime()
          ) {
            return "expired";
          }
          if (currentOrder.status !== "AWAITING_PAYMENT_PROOF") {
            const currentEvidence = await transaction.paymentEvidence.findUnique({
              where: { orderId },
              select: { id: true },
            });
            return currentEvidence ? "exists" : "not-ready";
          }
          return "not-ready";
        }

        await transaction.paymentEvidence.create({
          data: {
            orderId,
            storageKey: evidence.storageKey,
            originalFileName: evidence.originalFileName,
            contentType: evidence.contentType,
            sizeBytes: evidence.sizeBytes,
            transactionReference: evidence.transactionReference,
            receivedAt: evidence.receivedAt,
          },
        });
        return "created";
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return "exists";
      }
      throw error;
    }
  }

  public async findForActor(
    orderId: string,
    actor: PaymentEvidenceActor,
  ): Promise<PaymentEvidenceMetadata | null> {
    const evidence = await this.prisma.paymentEvidence.findUnique({
      where: { orderId },
      include: { order: { select: { customerId: true } } },
    });
    if (
      !evidence ||
      evidence.deletedAt !== null ||
      evidence.storageKey === null ||
      evidence.originalFileName === null ||
      evidence.contentType === null ||
      (actor.role !== "STORE_ADMIN" && evidence.order.customerId !== actor.customerId)
    ) {
      return null;
    }

    return {
      id: evidence.id,
      orderId: evidence.orderId,
      storageKey: evidence.storageKey,
      originalFileName: evidence.originalFileName,
      contentType: evidence.contentType,
      sizeBytes: evidence.sizeBytes,
      transactionReference: evidence.transactionReference,
      receivedAt: evidence.receivedAt,
    };
  }

  public async listPendingForAdmin(): Promise<PaymentEvidenceReviewRecord[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: "PAYMENT_REVIEW_PENDING",
        paymentEvidence: { isNot: null },
      },
      orderBy: [
        { paymentEvidence: { receivedAt: "asc" } },
        { orderId: "asc" },
      ],
      include: {
        lines: { orderBy: { id: "asc" } },
        paymentDecision: {
          select: { decision: true, decidedAt: true, reason: true },
        },
        paymentEvidence: true,
      },
    });

    return orders.map((order) => mapPaymentReview(order));
  }

  public async findPendingForAdmin(
    orderId: string,
  ): Promise<PaymentEvidenceReviewRecord | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        orderId,
        status: "PAYMENT_REVIEW_PENDING",
        paymentEvidence: { isNot: null },
      },
      include: {
        lines: { orderBy: { id: "asc" } },
        paymentDecision: {
          select: { decision: true, decidedAt: true, reason: true },
        },
        paymentEvidence: true,
      },
    });
    return order ? mapPaymentReview(order) : null;
  }

  public async placeLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reason: string,
    heldAt: Date,
  ): Promise<PaymentEvidenceLegalHoldResult> {
    return this.prisma.$transaction(async (transaction) => {
      const evidence = await transaction.paymentEvidence.findUnique({
        where: { orderId },
        select: {
          id: true,
          legalHold: true,
          deletedAt: true,
          storageKey: true,
          cleanupClaimToken: true,
        },
      });
      if (!evidence) {
        return "not-found";
      }
      if (evidence.deletedAt || !evidence.storageKey) {
        return "deleted";
      }
      if (evidence.legalHold) {
        return "already-updated";
      }
      if (evidence.cleanupClaimToken) {
        return "cleanup-in-progress";
      }

      const updated = await transaction.paymentEvidence.updateMany({
        where: {
          id: evidence.id,
          legalHold: false,
          deletedAt: null,
          storageKey: { not: null },
          cleanupClaimToken: null,
        },
        data: { legalHold: true },
      });
      if (updated.count !== 1) {
        return "cleanup-in-progress";
      }
      await transaction.paymentEvidenceLegalHold.create({
        data: {
          paymentEvidenceId: evidence.id,
          setByCustomerId: actor.customerId,
          reason,
          setAt: heldAt,
        },
      });
      return "updated";
    });
  }

  public async releaseLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reason: string,
    releasedAt: Date,
  ): Promise<PaymentEvidenceLegalHoldResult> {
    return this.prisma.$transaction(async (transaction) => {
      const evidence = await transaction.paymentEvidence.findUnique({
        where: { orderId },
        select: {
          id: true,
          legalHold: true,
          deletedAt: true,
          storageKey: true,
          cleanupClaimToken: true,
        },
      });
      if (!evidence) {
        return "not-found";
      }
      if (evidence.deletedAt || !evidence.storageKey) {
        return "deleted";
      }
      if (!evidence.legalHold) {
        return "already-updated";
      }
      if (evidence.cleanupClaimToken) {
        return "cleanup-in-progress";
      }

      const updated = await transaction.paymentEvidence.updateMany({
        where: {
          id: evidence.id,
          legalHold: true,
          deletedAt: null,
          storageKey: { not: null },
          cleanupClaimToken: null,
        },
        data: { legalHold: false },
      });
      if (updated.count !== 1) {
        return "cleanup-in-progress";
      }
      const released = await transaction.paymentEvidenceLegalHold.updateMany({
        where: { paymentEvidenceId: evidence.id, releasedAt: null },
        data: {
          releasedByCustomerId: actor.customerId,
          releaseReason: reason,
          releasedAt,
        },
      });
      if (released.count !== 1) {
        throw new Error(`Active legal hold audit record was not found for ${orderId}`);
      }
      return "updated";
    });
  }

  public async claimExpiredForCleanup(
    now: Date,
    limit: number,
    leaseMilliseconds: number,
  ): Promise<PaymentEvidenceCleanupClaim[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Payment evidence cleanup batch size must be a positive safe integer");
    }
    if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1) {
      throw new RangeError("Payment evidence cleanup lease must be a positive safe integer");
    }

    const candidates = await this.prisma.paymentEvidence.findMany({
      where: {
        retentionUntil: { lte: now },
        legalHold: false,
        deletedAt: null,
        storageKey: { not: null },
        OR: [
          { cleanupLeaseExpiresAt: null },
          { cleanupLeaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ retentionUntil: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, storageKey: true },
    });

    const claims: PaymentEvidenceCleanupClaim[] = [];
    for (const candidate of candidates) {
      if (!candidate.storageKey) {
        continue;
      }
      const claimToken = randomUUID();
      const claimed = await this.prisma.paymentEvidence.updateMany({
        where: {
          id: candidate.id,
          retentionUntil: { lte: now },
          legalHold: false,
          deletedAt: null,
          storageKey: candidate.storageKey,
          OR: [
            { cleanupLeaseExpiresAt: null },
            { cleanupLeaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          cleanupClaimToken: claimToken,
          cleanupLeaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        },
      });
      if (claimed.count === 1) {
        claims.push({ id: candidate.id, storageKey: candidate.storageKey, claimToken });
      }
    }
    return claims;
  }

  public async markEvidenceDeleted(
    id: string,
    claimToken: string,
    deletedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.paymentEvidence.updateMany({
      where: {
        id,
        cleanupClaimToken: claimToken,
        legalHold: false,
        deletedAt: null,
      },
      data: {
        storageKey: null,
        originalFileName: null,
        contentType: null,
        transactionReference: null,
        deletedAt,
        deletedByCustomerId: null,
        deletionReason: "RETENTION_EXPIRED",
        cleanupClaimToken: null,
        cleanupLeaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  public async claimForAdminDeletion(
    orderId: string,
    now: Date,
    leaseMilliseconds: number,
  ): Promise<PaymentEvidenceAdminDeleteClaimResult> {
    if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1) {
      throw new RangeError("Payment evidence cleanup lease must be a positive safe integer");
    }

    return this.prisma.$transaction(async (transaction) => {
      const evidence = await transaction.paymentEvidence.findUnique({
        where: { orderId },
        select: {
          id: true,
          storageKey: true,
          deletedAt: true,
          legalHold: true,
          cleanupLeaseExpiresAt: true,
        },
      });
      if (!evidence) {
        return "not-found";
      }
      if (evidence.deletedAt) {
        return { status: "deleted", deletedAt: evidence.deletedAt };
      }
      if (!evidence.storageKey) {
        return "cleanup-in-progress";
      }
      if (evidence.legalHold) {
        return "legal-hold";
      }

      const claimToken = randomUUID();
      const claimed = await transaction.paymentEvidence.updateMany({
        where: {
          id: evidence.id,
          legalHold: false,
          deletedAt: null,
          storageKey: evidence.storageKey,
          OR: [
            { cleanupLeaseExpiresAt: null },
            { cleanupLeaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          cleanupClaimToken: claimToken,
          cleanupLeaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        },
      });
      if (claimed.count !== 1) {
        return "cleanup-in-progress";
      }
      return {
        status: "claimed",
        claim: {
          id: evidence.id,
          storageKey: evidence.storageKey,
          claimToken,
        },
      };
    });
  }

  public async markEvidenceDeletedByAdmin(
    id: string,
    claimToken: string,
    actor: PaymentEvidenceActor,
    deletedAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.paymentEvidence.updateMany({
      where: {
        id,
        cleanupClaimToken: claimToken,
        legalHold: false,
        deletedAt: null,
      },
      data: {
        storageKey: null,
        deletedAt,
        deletedByCustomerId: actor.customerId,
        deletionReason: "ADMIN_CONFIRMED_DOWNLOAD",
        cleanupClaimToken: null,
        cleanupLeaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }
}
