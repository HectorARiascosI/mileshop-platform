import type { Readable } from "node:stream";

import type { Order } from "../orders.types.js";

export type PaymentEvidenceActor = {
  customerId: string;
  role: "CUSTOMER" | "STORE_ADMIN";
};

export type PaymentEvidenceMetadata = {
  id: string;
  orderId: string;
  storageKey: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  transactionReference: string | null;
  receivedAt: Date;
};

export type PaymentEvidenceInput = Omit<PaymentEvidenceMetadata, "id" | "receivedAt"> & {
  receivedAt: Date;
};

export type PaymentEvidenceSaveResult =
  | "created"
  | "not-found"
  | "forbidden"
  | "not-ready"
  | "expired"
  | "exists";

export type PaymentEvidenceLegalHoldResult =
  | "updated"
  | "already-updated"
  | "not-found"
  | "deleted"
  | "cleanup-in-progress";

export type PaymentEvidenceCleanupClaim = {
  id: string;
  storageKey: string;
  claimToken: string;
};

export type PaymentEvidenceAdminDeleteClaimResult =
  | { status: "claimed"; claim: PaymentEvidenceCleanupClaim }
  | { status: "deleted"; deletedAt: Date }
  | "not-found"
  | "legal-hold"
  | "cleanup-in-progress";

export type PaymentEvidenceReview = Omit<
  PaymentEvidenceMetadata,
  "storageKey"
> & {
  storageKey: string | null;
  deletedAt: Date | null;
  deletionReason: string | null;
};

export interface PaymentEvidenceRepository {
  findOrder(orderId: string): Promise<{
    customerId: string;
    status: string;
    reservationExpiresAt: Date | null;
  } | null>;
  createForActor(
    orderId: string,
    actor: PaymentEvidenceActor,
    evidence: PaymentEvidenceInput,
  ): Promise<PaymentEvidenceSaveResult>;
  findForActor(
    orderId: string,
    actor: PaymentEvidenceActor,
  ): Promise<PaymentEvidenceMetadata | null>;
  listPendingForAdmin(): Promise<PaymentEvidenceReviewRecord[]>;
  findPendingForAdmin(orderId: string): Promise<PaymentEvidenceReviewRecord | null>;
  placeLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reason: string,
    heldAt: Date,
  ): Promise<PaymentEvidenceLegalHoldResult>;
  releaseLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reason: string,
    releasedAt: Date,
  ): Promise<PaymentEvidenceLegalHoldResult>;
  claimExpiredForCleanup(
    now: Date,
    limit: number,
    leaseMilliseconds: number,
  ): Promise<PaymentEvidenceCleanupClaim[]>;
  claimForAdminDeletion(
    orderId: string,
    now: Date,
    leaseMilliseconds: number,
  ): Promise<PaymentEvidenceAdminDeleteClaimResult>;
  markEvidenceDeleted(
    id: string,
    claimToken: string,
    deletedAt: Date,
  ): Promise<boolean>;
  markEvidenceDeletedByAdmin(
    id: string,
    claimToken: string,
    actor: PaymentEvidenceActor,
    deletedAt: Date,
  ): Promise<boolean>;
}

export type PaymentEvidenceDownload = {
  metadata: PaymentEvidenceMetadata;
  stream: Readable;
};

export type PaymentEvidenceReviewRecord = {
  order: Order;
  evidence: PaymentEvidenceReview;
};
