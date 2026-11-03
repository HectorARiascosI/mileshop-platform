import assert from "node:assert/strict";
import test from "node:test";

import type {
  PaymentEvidenceCleanupClaim,
  PaymentEvidenceRepository,
} from "../src/payment-evidence/payment-evidence.repository.js";
import type { PaymentEvidenceStorage } from "../src/payment-evidence/payment-evidence.storage.js";
import { PaymentEvidenceRetentionWorker } from "../src/payment-evidence/payment-evidence-retention.worker.js";

test("deletes expired evidence and marks its metadata only after storage succeeds", async () => {
  const calls: string[] = [];
  const claim: PaymentEvidenceCleanupClaim = {
    id: "evidence-1",
    storageKey: "opaque-key",
    claimToken: "claim-1",
  };
  const repository = {
    claimExpiredForCleanup: async () => {
      calls.push("claim");
      return [claim];
    },
    markEvidenceDeleted: async (id: string, claimToken: string) => {
      calls.push(`mark:${id}:${claimToken}`);
      return true;
    },
  } as unknown as Pick<
    PaymentEvidenceRepository,
    "claimExpiredForCleanup" | "markEvidenceDeleted"
  >;
  const storage = {
    delete: async (storageKey: string) => {
      calls.push(`delete:${storageKey}`);
    },
  } as PaymentEvidenceStorage;
  const worker = new PaymentEvidenceRetentionWorker(repository, storage, true);

  assert.equal(await worker.cleanupExpiredEvidence(), 1);
  assert.deepEqual(calls, [
    "claim",
    "delete:opaque-key",
    "mark:evidence-1:claim-1",
  ]);
});

test("leaves failed deletions claimed for lease-based idempotent retry", async () => {
  let markedDeleted = false;
  const repository = {
    claimExpiredForCleanup: async () => [{
      id: "evidence-1",
      storageKey: "opaque-key",
      claimToken: "claim-1",
    }],
    markEvidenceDeleted: async () => {
      markedDeleted = true;
      return true;
    },
  } as unknown as Pick<
    PaymentEvidenceRepository,
    "claimExpiredForCleanup" | "markEvidenceDeleted"
  >;
  const storage = {
    delete: async () => {
      throw new Error("storage unavailable");
    },
  } as unknown as PaymentEvidenceStorage;
  const worker = new PaymentEvidenceRetentionWorker(repository, storage, true);

  assert.equal(await worker.cleanupExpiredEvidence(), 0);
  assert.equal(markedDeleted, false);
});

test("does not overlap concurrent retention scans", async () => {
  let releaseClaim!: () => void;
  let scanCount = 0;
  const repository = {
    claimExpiredForCleanup: async () => {
      scanCount += 1;
      await new Promise<void>((resolve) => {
        releaseClaim = resolve;
      });
      return [];
    },
    markEvidenceDeleted: async () => true,
  } as unknown as Pick<
    PaymentEvidenceRepository,
    "claimExpiredForCleanup" | "markEvidenceDeleted"
  >;
  const storage = { delete: async () => undefined } as PaymentEvidenceStorage;
  const worker = new PaymentEvidenceRetentionWorker(repository, storage, true);

  const firstScan = worker.cleanupExpiredEvidence();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await worker.cleanupExpiredEvidence(), 0);
  assert.equal(scanCount, 1);
  releaseClaim();
  assert.equal(await firstScan, 0);
});

test("does not claim or delete evidence when retention cleanup is disabled", async () => {
  let scanned = false;
  const repository = {
    claimExpiredForCleanup: async () => {
      scanned = true;
      return [];
    },
    markEvidenceDeleted: async () => true,
  } as unknown as Pick<
    PaymentEvidenceRepository,
    "claimExpiredForCleanup" | "markEvidenceDeleted"
  >;
  const storage = { delete: async () => undefined } as PaymentEvidenceStorage;
  const worker = new PaymentEvidenceRetentionWorker(repository, storage);

  assert.equal(await worker.cleanupExpiredEvidence(), 0);
  assert.equal(scanned, false);
});
