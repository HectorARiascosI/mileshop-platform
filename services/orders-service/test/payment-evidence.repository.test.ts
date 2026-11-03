import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { PrismaPaymentEvidenceRepository } from "../src/payment-evidence/prisma.payment-evidence.repository.js";
import type { PaymentEvidenceInput } from "../src/payment-evidence/payment-evidence.repository.js";

const evidence: PaymentEvidenceInput = {
  orderId: "order-1",
  storageKey: "opaque-key",
  originalFileName: "receipt.pdf",
  contentType: "application/pdf",
  sizeBytes: 23,
  transactionReference: null,
  receivedAt: new Date("2026-10-30T05:59:59.999Z"),
};

function createRepository(options: {
  order?: {
    customerId: string;
    status: string;
    reservationExpiresAt: Date | null;
  } | null;
  existingEvidence?: { id: string } | null;
  transitionCount?: number;
}) {
  let order = options.order ?? {
    customerId: "customer-1",
    status: "AWAITING_PAYMENT_PROOF",
    reservationExpiresAt: new Date("2026-10-30T06:00:00.000Z"),
  };
  let existingEvidence = options.existingEvidence ?? null;
  let createdEvidence: Record<string, unknown> | null = null;
  let transitionWhere: Record<string, unknown> | null = null;
  let transitionData: Record<string, unknown> | null = null;

  const transaction = {
    order: {
      findUnique: async () => order,
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        transitionWhere = args.where;
        transitionData = args.data;
        if (options.transitionCount === 0) {
          order = { ...order!, status: "PAYMENT_REVIEW_PENDING" };
          existingEvidence = { id: "evidence-1" };
          return { count: 0 };
        }
        order = {
          ...order!,
          status: String(args.data.status),
        };
        return { count: 1 };
      },
    },
    paymentEvidence: {
      findUnique: async () => existingEvidence,
      create: async (args: { data: Record<string, unknown> }) => {
        createdEvidence = args.data;
        existingEvidence = { id: "evidence-1" };
        return args.data;
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;

  return {
    repository: new PrismaPaymentEvidenceRepository(prisma),
    get order() {
      return order;
    },
    get createdEvidence() {
      return createdEvidence;
    },
    get transitionWhere() {
      return transitionWhere;
    },
    get transitionData() {
      return transitionData;
    },
  };
}

test("persists timely evidence and changes the order to review pending atomically", async () => {
  const harness = createRepository({});

  const result = await harness.repository.createForActor(
    "order-1",
    { customerId: "customer-1", role: "CUSTOMER" },
    evidence,
  );

  assert.equal(result, "created");
  assert.equal(harness.order?.status, "PAYMENT_REVIEW_PENDING");
  assert.deepEqual(harness.transitionWhere, {
    orderId: "order-1",
    customerId: "customer-1",
    status: "AWAITING_PAYMENT_PROOF",
    reservationExpiresAt: { gt: evidence.receivedAt },
  });
  assert.deepEqual(harness.transitionData, {
    status: "PAYMENT_REVIEW_PENDING",
    updatedAt: evidence.receivedAt,
  });
  assert.equal(harness.createdEvidence?.receivedAt, evidence.receivedAt);
});

test("does not transition when evidence receipt equals the reservation deadline", async () => {
  const deadlineEvidence = {
    ...evidence,
    receivedAt: new Date("2026-10-30T06:00:00.000Z"),
  };
  const harness = createRepository({});

  const result = await harness.repository.createForActor(
    "order-1",
    { customerId: "customer-1", role: "CUSTOMER" },
    deadlineEvidence,
  );

  assert.equal(result, "expired");
  assert.equal(harness.order?.status, "AWAITING_PAYMENT_PROOF");
  assert.equal(harness.transitionData, null);
  assert.equal(harness.createdEvidence, null);
});

test("reports a concurrent state transition without inserting evidence", async () => {
  const harness = createRepository({ transitionCount: 0 });

  const result = await harness.repository.createForActor(
    "order-1",
    { customerId: "customer-1", role: "CUSTOMER" },
    evidence,
  );

  assert.equal(result, "exists");
  assert.equal(harness.createdEvidence, null);
});

test("admin review queries retain pending orders after a manually downloaded file is deleted", async () => {
  const row = {
    id: "row-1",
    orderId: "order-1",
    customerId: "customer-1",
    idempotencyKey: "request-key",
    requestFingerprint: "fingerprint",
    subtotalCop: 10_000,
    deliveryFeeCop: 12_000,
    totalCop: 22_000,
    status: "PAYMENT_REVIEW_PENDING",
    reservationExpiresAt: new Date("2026-10-30T06:00:00.000Z"),
    cancelRequestedAt: null,
    cancelResolvedAt: null,
    cancelResolution: null,
    cancelResolvedByCustomerId: null,
    cancelResolutionNote: null,
    cancelPaymentCaptured: null,
    externalRefundRecordedByCustomerId: null,
    externalRefundReference: null,
    externalRefundHandledAt: null,
    createdAt: new Date("2026-10-30T00:00:00.000Z"),
    updatedAt: new Date("2026-10-30T00:05:00.000Z"),
    paymentDecision: null,
    lines: [{
      id: "line-1",
      productId: "product-1",
      sku: "SKU-1",
      name: "Product",
      quantity: 1,
      unitPriceCop: 10_000,
    }],
    paymentEvidence: {
      id: "evidence-1",
      orderId: "order-1",
      storageKey: null,
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 23,
      transactionReference: "transfer-9",
      receivedAt: new Date("2026-10-30T00:04:00.000Z"),
      deletedAt: new Date("2026-10-30T00:06:00.000Z"),
      deletionReason: "ADMIN_CONFIRMED_DOWNLOAD",
      deletedByCustomerId: "admin-1",
    },
  };
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const prisma = {
    order: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "findMany", args });
        return [row];
      },
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ operation: "findFirst", args });
        return row;
      },
    },
  } as unknown as PrismaClient;
  const repository = new PrismaPaymentEvidenceRepository(prisma);

  const queue = await repository.listPendingForAdmin();
  const detail = await repository.findPendingForAdmin("order-1");

  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.order.status, "PAYMENT_REVIEW_PENDING");
  assert.equal(queue[0]?.order.lines[0]?.id, "line-1");
  assert.equal(queue[0]?.evidence.storageKey, null);
  assert.equal(queue[0]?.evidence.deletedAt?.toISOString(), "2026-10-30T00:06:00.000Z");
  assert.equal(queue[0]?.evidence.originalFileName, "receipt.pdf");
  assert.equal(detail?.order.orderId, "order-1");
  assert.deepEqual(calls, [
    {
      operation: "findMany",
      args: {
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
      },
    },
    {
      operation: "findFirst",
      args: {
        where: {
          orderId: "order-1",
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
      },
    },
  ]);
});

test("admin deletion claims honor legal holds and record the actor after file removal", async () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const updateCalls: Array<Record<string, unknown>> = [];
  const transaction = {
    paymentEvidence: {
      findUnique: async () => ({
        id: "evidence-1",
        orderId: "order-1",
        storageKey: "private-key",
        deletedAt: null,
        legalHold: false,
        cleanupLeaseExpiresAt: null,
      }),
      updateMany: async (args: Record<string, unknown>) => {
        updateCalls.push(args);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
    paymentEvidence: {
      updateMany: async (args: Record<string, unknown>) => {
        updateCalls.push(args);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  const repository = new PrismaPaymentEvidenceRepository(prisma);

  const claimed = await repository.claimForAdminDeletion("order-1", now, 60_000);
  assert.ok(typeof claimed === "object" && "claim" in claimed);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.claim.storageKey, "private-key");
  assert.match(claimed.claim.claimToken, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(updateCalls[0], {
    where: {
      id: "evidence-1",
      legalHold: false,
      deletedAt: null,
      storageKey: "private-key",
      OR: [
        { cleanupLeaseExpiresAt: null },
        { cleanupLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      cleanupClaimToken: claimed.claim.claimToken,
      cleanupLeaseExpiresAt: new Date(now.getTime() + 60_000),
    },
  });

  assert.equal(
    await repository.markEvidenceDeletedByAdmin(
      "evidence-1",
      claimed.claim.claimToken,
      { customerId: "admin-1", role: "STORE_ADMIN" },
      now,
    ),
    true,
  );
  assert.deepEqual(updateCalls[1]?.data, {
    storageKey: null,
    deletedAt: now,
    deletedByCustomerId: "admin-1",
    deletionReason: "ADMIN_CONFIRMED_DOWNLOAD",
    cleanupClaimToken: null,
    cleanupLeaseExpiresAt: null,
  });
});
