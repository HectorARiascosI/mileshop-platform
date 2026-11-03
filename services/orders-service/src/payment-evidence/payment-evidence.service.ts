import type { PaymentEvidenceStorage, UploadedPaymentEvidence } from "./payment-evidence.storage.js";
import {
  PaymentEvidenceValidationError,
  validatePaymentEvidence,
} from "./payment-evidence.storage.js";
import type {
  PaymentEvidenceActor,
  PaymentEvidenceAdminDeleteClaimResult,
  PaymentEvidenceDownload,
  PaymentEvidenceMetadata,
  PaymentEvidenceReviewRecord,
  PaymentEvidenceRepository,
  PaymentEvidenceSaveResult,
} from "./payment-evidence.repository.js";
import type { Order } from "../orders.types.js";

export class PaymentEvidenceAccessError extends Error {
  public constructor() {
    super("Payment evidence was not found");
    this.name = "PaymentEvidenceAccessError";
  }
}

export class PaymentEvidenceConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PaymentEvidenceConflictError";
  }
}

export class PaymentEvidenceRetentionConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PaymentEvidenceRetentionConflictError";
  }
}

export type PaymentEvidenceReceipt = {
  orderId: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  transactionReference: string | null;
  receivedAt: string;
  status: "PAYMENT_REVIEW_PENDING";
};

export type PaymentEvidenceReviewMetadata = {
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  transactionReference: string | null;
  receivedAt: string;
  available: boolean;
  deletedAt: string | null;
};

export type PaymentEvidenceReviewSummary = Pick<
  Order,
  "orderId" | "customerId" | "totalCop" | "createdAt" | "reservationExpiresAt"
> & {
  evidence: PaymentEvidenceReviewMetadata;
};

export type PaymentEvidenceReviewDetail = {
  order: Order;
  evidence: PaymentEvidenceReviewMetadata;
};

function reviewMetadata(record: PaymentEvidenceReviewRecord): PaymentEvidenceReviewMetadata {
  return {
    originalFileName: record.evidence.originalFileName,
    contentType: record.evidence.contentType,
    sizeBytes: record.evidence.sizeBytes,
    transactionReference: record.evidence.transactionReference,
    receivedAt: record.evidence.receivedAt.toISOString(),
    available: record.evidence.storageKey !== null && record.evidence.deletedAt === null,
    deletedAt: record.evidence.deletedAt?.toISOString() ?? null,
  };
}

function validateTransactionReference(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new PaymentEvidenceValidationError("The transaction reference is invalid");
  }

  const reference = value.trim();
  if (reference.length > 128 || /[\u0000-\u001f\u007f]/.test(reference)) {
    throw new PaymentEvidenceValidationError("The transaction reference is invalid");
  }
  return reference || null;
}

export class PaymentEvidenceService {
  public constructor(
    private readonly repository: PaymentEvidenceRepository,
    private readonly storage: PaymentEvidenceStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async upload(
    orderId: string,
    actor: PaymentEvidenceActor,
    upload: UploadedPaymentEvidence,
    transactionReference?: unknown,
  ): Promise<PaymentEvidenceReceipt> {
    const receivedAt = this.now();
    const validated = validatePaymentEvidence(upload);
    const normalizedReference = validateTransactionReference(transactionReference);
    const order = await this.repository.findOrder(orderId);
    if (!order || order.customerId !== actor.customerId || actor.role !== "CUSTOMER") {
      throw new PaymentEvidenceAccessError();
    }
    if (
      order.reservationExpiresAt === null ||
      order.reservationExpiresAt.getTime() <= receivedAt.getTime()
    ) {
      throw new PaymentEvidenceConflictError("The order reservation has expired");
    }
    if (order.status !== "AWAITING_PAYMENT_PROOF") {
      throw new PaymentEvidenceConflictError(
        "Payment evidence can only be uploaded while the order is awaiting proof",
      );
    }

    const stored = await this.storage.store(validated);
    let result: PaymentEvidenceSaveResult;
    try {
      result = await this.repository.createForActor(orderId, actor, {
        orderId,
        storageKey: stored.storageKey,
        originalFileName: validated.originalFileName,
        contentType: validated.contentType,
        sizeBytes: validated.sizeBytes,
        transactionReference: normalizedReference,
        receivedAt,
      });
    } catch (error) {
      try {
        await this.storage.delete(stored.storageKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Payment evidence persistence failed and its stored file could not be removed",
        );
      }
      throw error;
    }

    if (result !== "created") {
      await this.storage.delete(stored.storageKey);
      if (result === "not-found" || result === "forbidden") {
        throw new PaymentEvidenceAccessError();
      }
      if (result === "not-ready") {
        throw new PaymentEvidenceConflictError(
          "Payment evidence can only be uploaded while the order is awaiting proof",
        );
      }
      if (result === "expired") {
        throw new PaymentEvidenceConflictError("The order reservation has expired");
      }
      throw new PaymentEvidenceConflictError("Payment evidence has already been submitted");
    }

    return {
      orderId,
      originalFileName: validated.originalFileName,
      contentType: validated.contentType,
      sizeBytes: validated.sizeBytes,
      transactionReference: normalizedReference,
      receivedAt: receivedAt.toISOString(),
      status: "PAYMENT_REVIEW_PENDING",
    };
  }

  public async open(
    orderId: string,
    actor: PaymentEvidenceActor,
  ): Promise<PaymentEvidenceDownload> {
    const metadata = await this.repository.findForActor(orderId, actor);
    if (!metadata) {
      throw new PaymentEvidenceAccessError();
    }
    return {
      metadata,
      stream: await this.storage.openRead(metadata.storageKey),
    };
  }

  public async listPendingForAdmin(
    actor: PaymentEvidenceActor,
  ): Promise<PaymentEvidenceReviewSummary[]> {
    this.requireAdmin(actor);
    const records = await this.repository.listPendingForAdmin();
    return records.map(({ order, evidence }) => ({
      orderId: order.orderId,
      customerId: order.customerId,
      totalCop: order.totalCop,
      createdAt: order.createdAt,
      reservationExpiresAt: order.reservationExpiresAt,
      evidence: {
        originalFileName: evidence.originalFileName,
        contentType: evidence.contentType,
        sizeBytes: evidence.sizeBytes,
        transactionReference: evidence.transactionReference,
        receivedAt: evidence.receivedAt.toISOString(),
        available: evidence.storageKey !== null && evidence.deletedAt === null,
        deletedAt: evidence.deletedAt?.toISOString() ?? null,
      },
    }));
  }

  public async getPendingForAdmin(
    orderId: string,
    actor: PaymentEvidenceActor,
  ): Promise<PaymentEvidenceReviewDetail> {
    this.requireAdmin(actor);
    const record = await this.repository.findPendingForAdmin(orderId);
    if (!record) {
      throw new PaymentEvidenceAccessError();
    }
    return {
      order: record.order,
      evidence: reviewMetadata(record),
    };
  }

  public async deleteAfterAdminDownload(
    orderId: string,
    actor: PaymentEvidenceActor,
    confirmedDownloaded: unknown,
  ): Promise<{ orderId: string; available: false; deletedAt: string }> {
    this.requireAdmin(actor);
    if (confirmedDownloaded !== true) {
      throw new PaymentEvidenceValidationError(
        "Confirm that the payment evidence was downloaded and saved before deleting it",
      );
    }

    const deletedAt = this.now();
    const claimResult: PaymentEvidenceAdminDeleteClaimResult =
      await this.repository.claimForAdminDeletion(orderId, deletedAt, 60_000);
    if (claimResult === "not-found") {
      throw new PaymentEvidenceAccessError();
    }
    if (claimResult === "legal-hold") {
      throw new PaymentEvidenceRetentionConflictError(
        "Payment evidence is under legal hold and cannot be deleted",
      );
    }
    if (claimResult === "cleanup-in-progress") {
      throw new PaymentEvidenceRetentionConflictError(
        "Payment evidence cleanup is already in progress",
      );
    }
    if (claimResult.status === "deleted") {
      return {
        orderId,
        available: false,
        deletedAt: claimResult.deletedAt.toISOString(),
      };
    }

    const { claim } = claimResult;
    await this.storage.delete(claim.storageKey);
    const markedDeleted = await this.repository.markEvidenceDeletedByAdmin(
      claim.id,
      claim.claimToken,
      actor,
      deletedAt,
    );
    if (!markedDeleted) {
      throw new PaymentEvidenceRetentionConflictError(
        "Payment evidence deletion could not be recorded; retry after refreshing the payment",
      );
    }
    return {
      orderId,
      available: false,
      deletedAt: deletedAt.toISOString(),
    };
  }

  public async placeLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reasonInput: unknown,
  ): Promise<{ orderId: string; legalHold: true; changed: boolean }> {
    this.requireAdmin(actor);
    const reason = this.validateHoldReason(reasonInput);
    const result = await this.repository.placeLegalHold(
      orderId,
      actor,
      reason,
      this.now(),
    );
    if (result === "not-found") {
      throw new PaymentEvidenceAccessError();
    }
    if (result === "deleted") {
      throw new PaymentEvidenceRetentionConflictError(
        "Payment evidence was already deleted and cannot be placed on hold",
      );
    }
    if (result === "cleanup-in-progress") {
      throw new PaymentEvidenceRetentionConflictError(
        "Payment evidence cleanup is already in progress",
      );
    }
    return { orderId, legalHold: true, changed: result === "updated" };
  }

  public async releaseLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reasonInput: unknown,
  ): Promise<{ orderId: string; legalHold: false; changed: boolean }> {
    this.requireAdmin(actor);
    const reason = this.validateHoldReason(reasonInput);
    const result = await this.repository.releaseLegalHold(
      orderId,
      actor,
      reason,
      this.now(),
    );
    if (result === "not-found") {
      throw new PaymentEvidenceAccessError();
    }
    if (result === "deleted") {
      throw new PaymentEvidenceRetentionConflictError(
        "Deleted payment evidence has no active legal hold",
      );
    }
    if (result === "cleanup-in-progress") {
      throw new PaymentEvidenceRetentionConflictError(
        "Payment evidence cleanup is already in progress",
      );
    }
    return { orderId, legalHold: false, changed: result === "updated" };
  }

  private validateHoldReason(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 1000) {
      throw new PaymentEvidenceValidationError(
        "A legal-hold reason between 1 and 1000 characters is required",
      );
    }
    return value.trim();
  }

  private requireAdmin(actor: PaymentEvidenceActor): void {
    if (actor.role !== "STORE_ADMIN") {
      throw new PaymentEvidenceAccessError();
    }
  }
}
