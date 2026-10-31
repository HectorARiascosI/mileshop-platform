import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";

import {
  PaymentEvidenceAccessError,
  PaymentEvidenceConflictError,
  PaymentEvidenceService,
} from "../src/payment-evidence/payment-evidence.service.js";
import type {
  PaymentEvidenceAdminDeleteClaimResult,
  PaymentEvidenceActor,
  PaymentEvidenceInput,
  PaymentEvidenceMetadata,
  PaymentEvidenceReviewRecord,
  PaymentEvidenceRepository,
  PaymentEvidenceSaveResult,
} from "../src/payment-evidence/payment-evidence.repository.js";
import type {
  PaymentEvidenceStorage,
  StoredPaymentEvidence,
  ValidatedPaymentEvidence,
} from "../src/payment-evidence/payment-evidence.storage.js";

const pdf = {
  originalFileName: "receipt.pdf",
  contentType: "application/pdf",
  bytes: Buffer.from("%PDF-1.7\nreceipt\n%%EOF\n"),
};
const owner: PaymentEvidenceActor = { customerId: "customer-1", role: "CUSTOMER" };
const otherCustomer: PaymentEvidenceActor = { customerId: "customer-2", role: "CUSTOMER" };
const admin: PaymentEvidenceActor = { customerId: "admin-1", role: "STORE_ADMIN" };

class EvidenceRepository implements PaymentEvidenceRepository {
  public status = "AWAITING_PAYMENT_PROOF";
  public ownerId = owner.customerId;
  public reservationExpiresAt = new Date("2099-10-30T06:00:00.000Z");
  public existing: PaymentEvidenceMetadata | null = null;
  public saved: PaymentEvidenceInput | null = null;
  public saveResult: PaymentEvidenceSaveResult = "created";
  public saveError: Error | null = null;
  public reviews: PaymentEvidenceReviewRecord[] = [];
  public legalHoldResult: "updated" | "already-updated" | "not-found" | "deleted" | "cleanup-in-progress" =
    "updated";
  public holdCall: Record<string, unknown> | null = null;
  public releaseCall: Record<string, unknown> | null = null;
  public adminDeleteClaim: PaymentEvidenceAdminDeleteClaimResult = {
    status: "claimed",
    claim: {
      id: "evidence-1",
      storageKey: "private-storage-key",
      claimToken: "admin-delete-token",
    },
  };
  public adminDeleteCall: Record<string, unknown> | null = null;

  public async findOrder(): Promise<{
    customerId: string;
    status: string;
    reservationExpiresAt: Date | null;
  }> {
    return {
      customerId: this.ownerId,
      status: this.status,
      reservationExpiresAt: this.reservationExpiresAt,
    };
  }

  public async createForActor(
    _orderId: string,
    _actor: PaymentEvidenceActor,
    evidence: PaymentEvidenceInput,
  ): Promise<PaymentEvidenceSaveResult> {
    if (this.saveError) {
      throw this.saveError;
    }
    if (this.status !== "AWAITING_PAYMENT_PROOF") {
      return "not-ready";
    }
    if (!this.reservationExpiresAt || evidence.receivedAt >= this.reservationExpiresAt) {
      return "expired";
    }
    if (this.saveResult !== "created") {
      return this.saveResult;
    }
    this.saved = evidence;
    this.status = "PAYMENT_REVIEW_PENDING";
    return "created";
  }

  public async findForActor(): Promise<PaymentEvidenceMetadata | null> {
    return this.existing;
  }

  public async listPendingForAdmin(): Promise<PaymentEvidenceReviewRecord[]> {
    return this.reviews;
  }

  public async findPendingForAdmin(
    orderId: string,
  ): Promise<PaymentEvidenceReviewRecord | null> {
    return this.reviews.find((review) => review.order.orderId === orderId) ?? null;
  }

  public async placeLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reason: string,
    heldAt: Date,
  ) {
    this.holdCall = { orderId, actor, reason, heldAt };
    return this.legalHoldResult;
  }

  public async releaseLegalHold(
    orderId: string,
    actor: PaymentEvidenceActor,
    reason: string,
    releasedAt: Date,
  ) {
    this.releaseCall = { orderId, actor, reason, releasedAt };
    return this.legalHoldResult;
  }

  public async claimExpiredForCleanup() {
    return [];
  }

  public async markEvidenceDeleted() {
    return true;
  }

  public async claimForAdminDeletion(): Promise<PaymentEvidenceAdminDeleteClaimResult> {
    return this.adminDeleteClaim;
  }

  public async markEvidenceDeletedByAdmin(
    id: string,
    claimToken: string,
    actor: PaymentEvidenceActor,
    deletedAt: Date,
  ): Promise<boolean> {
    this.adminDeleteCall = { id, claimToken, actor, deletedAt };
    for (const review of this.reviews) {
      if (review.evidence.id === id) {
        review.evidence.storageKey = null;
        review.evidence.deletedAt = deletedAt;
        review.evidence.deletionReason = "ADMIN_CONFIRMED_DOWNLOAD";
      }
    }
    this.adminDeleteClaim = { status: "deleted", deletedAt };
    return true;
  }
}

class EvidenceStorage implements PaymentEvidenceStorage {
  public stored: ValidatedPaymentEvidence | null = null;
  public deleted: string[] = [];

  public async store(file: ValidatedPaymentEvidence): Promise<StoredPaymentEvidence> {
    this.stored = file;
    return { storageKey: "opaque-key" };
  }

  public openRead(): Readable {
    return Readable.from([Buffer.from("proof")]);
  }

  public async delete(storageKey: string): Promise<void> {
    this.deleted.push(storageKey);
  }
}

const pendingReview: PaymentEvidenceReviewRecord = {
  order: {
    id: "row-1",
    orderId: "order-1",
    customerId: "customer-1",
    subtotalCop: 10_000,
    deliveryFeeCop: 12_000,
    totalCop: 22_000,
    status: "PAYMENT_REVIEW_PENDING",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:05:00.000Z",
    lines: [],
    paymentDecision: null,
  },
  evidence: {
    id: "evidence-1",
    orderId: "order-1",
    storageKey: "private-storage-key",
    originalFileName: "receipt.pdf",
    contentType: "application/pdf",
    sizeBytes: 23,
    transactionReference: "transfer-9",
    receivedAt: new Date("2026-10-30T00:04:00.000Z"),
    deletedAt: null,
    deletionReason: null,
  },
};

test("stores an owner's validated evidence and optional transaction reference", async () => {
  const repository = new EvidenceRepository();
  const storage = new EvidenceStorage();
  const receivedAt = new Date("2026-10-30T05:59:59.999Z");
  const service = new PaymentEvidenceService(repository, storage, () => receivedAt);

  const receipt = await service.upload("order-1", owner, pdf, "  transaction-123  ");

  assert.equal(receipt.orderId, "order-1");
  assert.equal(receipt.originalFileName, "receipt.pdf");
  assert.equal(receipt.transactionReference, "transaction-123");
  assert.equal(receipt.sizeBytes, pdf.bytes.byteLength);
  assert.equal(repository.saved?.storageKey, "opaque-key");
  assert.equal(repository.saved?.receivedAt, receivedAt);
  assert.equal(repository.status, "PAYMENT_REVIEW_PENDING");
  assert.equal(storage.deleted.length, 0);
  assert.equal("storageKey" in receipt, false);
  assert.equal(receipt.receivedAt, receivedAt.toISOString());
  assert.equal(receipt.status, "PAYMENT_REVIEW_PENDING");
});

test("does not store evidence for a different customer or allow admins to upload", async () => {
  const repository = new EvidenceRepository();
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(repository, storage);

  await assert.rejects(
    () => service.upload("order-1", otherCustomer, pdf),
    PaymentEvidenceAccessError,
  );
  await assert.rejects(
    () => service.upload("order-1", admin, pdf),
    PaymentEvidenceAccessError,
  );
  assert.equal(storage.stored, null);
});

test("only accepts uploads while the order awaits proof", async () => {
  const repository = new EvidenceRepository();
  repository.status = "RESERVING_INVENTORY";
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(repository, storage);

  await assert.rejects(
    () => service.upload("order-1", owner, pdf),
    PaymentEvidenceConflictError,
  );
  assert.equal(storage.stored, null);
});

test("rejects proof received exactly at the reservation deadline", async () => {
  const repository = new EvidenceRepository();
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(
    repository,
    storage,
    () => new Date(repository.reservationExpiresAt!),
  );

  await assert.rejects(
    () => service.upload("order-1", owner, pdf),
    /reservation has expired/i,
  );
  assert.equal(storage.stored, null);
  assert.equal(repository.status, "AWAITING_PAYMENT_PROOF");
});

test("rejects proof received after the reservation deadline without storing it", async () => {
  const repository = new EvidenceRepository();
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(
    repository,
    storage,
    () => new Date(repository.reservationExpiresAt!.getTime() + 1),
  );

  await assert.rejects(
    () => service.upload("order-1", owner, pdf),
    /reservation has expired/i,
  );
  assert.equal(storage.stored, null);
  assert.equal(repository.status, "AWAITING_PAYMENT_PROOF");
});

test("removes staged storage if the conditional database transition fails", async () => {
  const repository = new EvidenceRepository();
  repository.saveResult = "expired";
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(
    repository,
    storage,
    () => new Date("2026-10-30T05:00:00.000Z"),
  );

  await assert.rejects(
    () => service.upload("order-1", owner, pdf),
    /reservation has expired/i,
  );
  assert.deepEqual(storage.deleted, ["opaque-key"]);
});

test("surfaces persistence and cleanup failures instead of hiding either", async () => {
  const repository = new EvidenceRepository();
  repository.saveError = new Error("database unavailable");
  const storage = new EvidenceStorage();
  storage.delete = async () => {
    throw new Error("private storage unavailable");
  };
  const service = new PaymentEvidenceService(
    repository,
    storage,
    () => new Date("2026-10-30T05:00:00.000Z"),
  );

  await assert.rejects(
    () => service.upload("order-1", owner, pdf),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.some(
        (cause) => cause instanceof Error && cause.message === "database unavailable",
      ) &&
      error.errors.some(
        (cause) => cause instanceof Error && cause.message === "private storage unavailable",
      ),
  );
});

test("removes the stored file when a concurrent or duplicate submission loses", async () => {
  const repository = new EvidenceRepository();
  repository.saveResult = "exists";
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(repository, storage);

  await assert.rejects(
    () => service.upload("order-1", owner, pdf),
    /already been submitted/,
  );
  assert.deepEqual(storage.deleted, ["opaque-key"]);
});

test("rejects an invalid transaction reference before writing storage", async () => {
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(new EvidenceRepository(), storage);

  await assert.rejects(
    () => service.upload("order-1", owner, pdf, "x".repeat(129)),
    /transaction reference is invalid/,
  );
  assert.equal(storage.stored, null);
});

test("opens evidence only when the repository grants actor access", async () => {
  const repository = new EvidenceRepository();
  repository.existing = {
    id: "evidence-1",
    orderId: "order-1",
    storageKey: "opaque-key",
    originalFileName: "receipt.pdf",
    contentType: "application/pdf",
    sizeBytes: 5,
    transactionReference: null,
    receivedAt: new Date("2026-10-30T00:00:00.000Z"),
  };
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(repository, storage);

  assert.equal((await service.open("order-1", owner)).metadata.storageKey, "opaque-key");
  assert.equal((await service.open("order-1", admin)).metadata.storageKey, "opaque-key");
  repository.existing = null;
  await assert.rejects(() => service.open("order-1", otherCustomer), PaymentEvidenceAccessError);
});

test("lists and returns pending payment details only for store admins", async () => {
  const repository = new EvidenceRepository();
  repository.reviews = [pendingReview];
  const service = new PaymentEvidenceService(repository, new EvidenceStorage());

  const queue = await service.listPendingForAdmin(admin);
  assert.deepEqual(queue, [{
    orderId: "order-1",
    customerId: "customer-1",
    totalCop: 22_000,
    createdAt: "2026-10-30T00:00:00.000Z",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    evidence: {
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 23,
      transactionReference: "transfer-9",
      receivedAt: "2026-10-30T00:04:00.000Z",
      available: true,
      deletedAt: null,
    },
  }]);
  assert.equal("storageKey" in queue[0]!.evidence, false);

  const detail = await service.getPendingForAdmin("order-1", admin);
  assert.equal(detail.order.orderId, "order-1");
  assert.equal(detail.evidence.originalFileName, "receipt.pdf");
  assert.equal("storageKey" in detail.evidence, false);

  await assert.rejects(
    () => service.listPendingForAdmin(owner),
    PaymentEvidenceAccessError,
  );
  await assert.rejects(
    () => service.getPendingForAdmin("missing-order", admin),
    PaymentEvidenceAccessError,
  );
});

test("records audited legal-hold placement and release only for admins", async () => {
  const repository = new EvidenceRepository();
  const heldAt = new Date("2026-10-30T12:00:00.000Z");
  const service = new PaymentEvidenceService(
    repository,
    new EvidenceStorage(),
    () => heldAt,
  );

  assert.deepEqual(
    await service.placeLegalHold("order-1", admin, "  Active dispute  "),
    { orderId: "order-1", legalHold: true, changed: true },
  );
  assert.deepEqual(repository.holdCall, {
    orderId: "order-1",
    actor: admin,
    reason: "Active dispute",
    heldAt,
  });

  repository.legalHoldResult = "already-updated";
  assert.deepEqual(
    await service.placeLegalHold("order-1", admin, "Active dispute"),
    { orderId: "order-1", legalHold: true, changed: false },
  );
  assert.deepEqual(
    await service.releaseLegalHold("order-1", admin, "  Dispute resolved  "),
    { orderId: "order-1", legalHold: false, changed: false },
  );
  assert.deepEqual(repository.releaseCall, {
    orderId: "order-1",
    actor: admin,
    reason: "Dispute resolved",
    releasedAt: heldAt,
  });

  await assert.rejects(
    () => service.placeLegalHold("order-1", owner, "Dispute"),
    PaymentEvidenceAccessError,
  );
  await assert.rejects(
    () => service.releaseLegalHold("order-1", admin, " "),
    /legal-hold reason between 1 and 1000 characters/,
  );
});

test("requires explicit admin confirmation before deleting payment evidence", async () => {
  const repository = new EvidenceRepository();
  const storage = new EvidenceStorage();
  const service = new PaymentEvidenceService(repository, storage);

  await assert.rejects(
    () => service.deleteAfterAdminDownload("order-1", owner, true),
    PaymentEvidenceAccessError,
  );
  await assert.rejects(
    () => service.deleteAfterAdminDownload("order-1", admin, false),
    /Confirm that the payment evidence was downloaded and saved/,
  );
  assert.deepEqual(storage.deleted, []);
});

test("deletes only the stored file after admin confirmation and preserves payment review", async () => {
  const repository = new EvidenceRepository();
  repository.reviews = [{
    order: { ...pendingReview.order },
    evidence: { ...pendingReview.evidence },
  }];
  const storage = new EvidenceStorage();
  const deletedAt = new Date("2026-10-30T12:00:00.000Z");
  const service = new PaymentEvidenceService(repository, storage, () => deletedAt);

  const result = await service.deleteAfterAdminDownload("order-1", admin, true);

  assert.deepEqual(result, {
    orderId: "order-1",
    available: false,
    deletedAt: deletedAt.toISOString(),
  });
  assert.deepEqual(storage.deleted, ["private-storage-key"]);
  assert.deepEqual(repository.adminDeleteCall, {
    id: "evidence-1",
    claimToken: "admin-delete-token",
    actor: admin,
    deletedAt,
  });
  assert.equal(repository.reviews[0]!.order.status, "PAYMENT_REVIEW_PENDING");
  assert.equal(repository.reviews[0]!.evidence.storageKey, null);
  assert.equal(repository.reviews[0]!.evidence.originalFileName, "receipt.pdf");
  assert.equal(repository.reviews[0]!.evidence.transactionReference, "transfer-9");
  assert.equal(repository.reviews[0]!.evidence.deletionReason, "ADMIN_CONFIRMED_DOWNLOAD");

  const queue = await service.listPendingForAdmin(admin);
  assert.equal(queue[0]!.evidence.available, false);
  assert.equal(queue[0]!.evidence.deletedAt, deletedAt.toISOString());

  repository.reviews = [];
  const repeatedResult = await service.deleteAfterAdminDownload("order-1", admin, true);
  assert.deepEqual(repeatedResult, result);
  assert.deepEqual(storage.deleted, ["private-storage-key"]);
});
