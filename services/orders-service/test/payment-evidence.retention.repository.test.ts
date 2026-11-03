import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { PrismaPaymentEvidenceRepository } from "../src/payment-evidence/prisma.payment-evidence.repository.js";
import type { PaymentEvidenceActor } from "../src/payment-evidence/payment-evidence.repository.js";

const admin: PaymentEvidenceActor = {
  customerId: "admin-1",
  role: "STORE_ADMIN",
};

test("places and releases a legal hold with actor, reason, and timestamps in audit history", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  let legalHold = false;
  const transaction = {
    paymentEvidence: {
      findUnique: async () => ({
        id: "evidence-1",
        legalHold,
        deletedAt: null,
        storageKey: "opaque-key",
        cleanupClaimToken: null,
      }),
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "paymentEvidence.updateMany", args });
        legalHold = (args.data as { legalHold: boolean }).legalHold;
        return { count: 1 };
      },
    },
    paymentEvidenceLegalHold: {
      create: async (args: Record<string, unknown>) => {
        calls.push({ operation: "legalHold.create", args });
      },
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "legalHold.updateMany", args });
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaPaymentEvidenceRepository(prisma);
  const heldAt = new Date("2026-10-30T12:00:00.000Z");
  const releasedAt = new Date("2026-10-31T12:00:00.000Z");

  assert.equal(await repository.placeLegalHold("order-1", admin, "Dispute", heldAt), "updated");
  assert.equal(await repository.placeLegalHold("order-1", admin, "Dispute", heldAt), "already-updated");
  assert.equal(await repository.releaseLegalHold("order-1", admin, "Resolved", releasedAt), "updated");
  assert.deepEqual(calls, [
    {
      operation: "paymentEvidence.updateMany",
      args: {
        where: {
          id: "evidence-1",
          legalHold: false,
          deletedAt: null,
          storageKey: { not: null },
          cleanupClaimToken: null,
        },
        data: { legalHold: true },
      },
    },
    {
      operation: "legalHold.create",
      args: {
        data: {
          paymentEvidenceId: "evidence-1",
          setByCustomerId: "admin-1",
          reason: "Dispute",
          setAt: heldAt,
        },
      },
    },
    {
      operation: "paymentEvidence.updateMany",
      args: {
        where: {
          id: "evidence-1",
          legalHold: true,
          deletedAt: null,
          storageKey: { not: null },
          cleanupClaimToken: null,
        },
        data: { legalHold: false },
      },
    },
    {
      operation: "legalHold.updateMany",
      args: {
        where: { paymentEvidenceId: "evidence-1", releasedAt: null },
        data: {
          releasedByCustomerId: "admin-1",
          releaseReason: "Resolved",
          releasedAt,
        },
      },
    },
  ]);
});

test("claims only retention-expired, unheld evidence and skips a concurrent hold", async () => {
  const now = new Date("2027-10-30T12:00:00.000Z");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  let claimCount = 1;
  const prisma = {
    paymentEvidence: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "findMany", args });
        return [{ id: "evidence-1", storageKey: "opaque-key" }];
      },
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "updateMany", args });
        return { count: claimCount };
      },
    },
  } as unknown as PrismaClient;
  const repository = new PrismaPaymentEvidenceRepository(prisma);

  const claims = await repository.claimExpiredForCleanup(now, 25, 60_000);
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.id, "evidence-1");
  assert.equal(claims[0]?.storageKey, "opaque-key");
  assert.deepEqual(calls[0], {
    operation: "findMany",
    args: {
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
      take: 25,
      select: { id: true, storageKey: true },
    },
  });
  const claimUpdate = calls[1]?.args;
  assert.deepEqual((claimUpdate?.where as Record<string, unknown>).legalHold, false);
  assert.deepEqual((claimUpdate?.where as Record<string, unknown>).retentionUntil, { lte: now });
  assert.deepEqual((claimUpdate?.data as Record<string, unknown>).cleanupLeaseExpiresAt,
    new Date(now.getTime() + 60_000));

  claimCount = 0;
  assert.deepEqual(await repository.claimExpiredForCleanup(now, 25, 60_000), []);
});

test("scrubs the storage key and private metadata only after the claimed file is deleted", async () => {
  let updateArgs: Record<string, unknown> | null = null;
  const prisma = {
    paymentEvidence: {
      updateMany: async (args: Record<string, unknown>) => {
        updateArgs = args;
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const repository = new PrismaPaymentEvidenceRepository(prisma);

  assert.equal(
    await repository.markEvidenceDeleted("evidence-1", "claim-1", new Date("2027-10-30T12:00:00.000Z")),
    true,
  );
  assert.deepEqual(updateArgs, {
    where: {
      id: "evidence-1",
      cleanupClaimToken: "claim-1",
      legalHold: false,
      deletedAt: null,
    },
    data: {
      storageKey: null,
      originalFileName: null,
      contentType: null,
      transactionReference: null,
      deletedAt: new Date("2027-10-30T12:00:00.000Z"),
      deletedByCustomerId: null,
      deletionReason: "RETENTION_EXPIRED",
      cleanupClaimToken: null,
      cleanupLeaseExpiresAt: null,
    },
  });
});
