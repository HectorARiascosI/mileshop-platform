import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { PrismaOrdersRepository } from "../src/prisma.orders.repository.js";

test("records an owner cancellation request without releasing inventory", async () => {
  const requestedAt = new Date("2026-10-30T12:00:00.000Z");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);

  assert.equal(
    await repository.requestCancellation("order-1", "customer-1", requestedAt),
    "requested",
  );
  assert.deepEqual(calls, [
    {
      operation: "order.updateMany",
      args: {
        where: {
          orderId: "order-1",
          customerId: "customer-1",
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { is: { deletedAt: null } },
          cancelRequestedAt: null,
        },
        data: { cancelRequestedAt: requestedAt, updatedAt: requestedAt },
      },
    },
  ]);
});

test("records external refund handling before cancellation and atomically enqueues RELEASE", async () => {
  const recordedAt = new Date("2026-10-30T12:01:00.000Z");
  const resolvedAt = new Date("2026-10-30T12:02:00.000Z");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
        return { count: 1 };
      },
    },
    paymentEvidence: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "paymentEvidence.updateMany", args });
        return { count: 1 };
      },
    },
    inventoryCommandOutbox: {
      create: async (args: Record<string, unknown>) => {
        calls.push({ operation: "inventoryCommandOutbox.create", args });
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);
  const releaseCommand = {
    commandId: "order-1-release-inventory",
    idempotencyKey: "order-1:RELEASE",
    orderId: "order-1",
    commandType: "RELEASE" as const,
    payload: {},
  };

  assert.equal(
    await repository.recordCancellationRefund(
      "order-1",
      "admin-1",
      true,
      "refund-ref-123",
      recordedAt,
    ),
    "recorded",
  );
  assert.equal(
    await repository.resolveCancellationRequest(
      "order-1",
      "admin-1",
      "CANCEL",
      "External refund completed.",
      resolvedAt,
      releaseCommand,
    ),
    "cancelled",
  );
  assert.deepEqual(calls, [
    {
      operation: "order.updateMany",
      args: {
        where: {
          orderId: "order-1",
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          cancelRequestedAt: { not: null },
          cancelResolvedAt: null,
          cancelPaymentCaptured: null,
        },
        data: {
          cancelPaymentCaptured: true,
          externalRefundRecordedByCustomerId: "admin-1",
          externalRefundReference: "refund-ref-123",
          externalRefundHandledAt: recordedAt,
          updatedAt: recordedAt,
        },
      },
    },
    {
      operation: "order.updateMany",
      args: {
        where: {
          orderId: "order-1",
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          cancelRequestedAt: { not: null },
          cancelResolvedAt: null,
          OR: [
            { cancelPaymentCaptured: false },
            {
              cancelPaymentCaptured: true,
              externalRefundHandledAt: { not: null },
              externalRefundReference: { not: null },
            },
          ],
        },
        data: {
          status: "CANCELLED",
          cancelResolvedAt: resolvedAt,
          cancelResolution: "CANCELLED",
          cancelResolvedByCustomerId: "admin-1",
          cancelResolutionNote: "External refund completed.",
          updatedAt: resolvedAt,
        },
      },
    },
    {
      operation: "paymentEvidence.updateMany",
      args: {
        where: { orderId: "order-1", retentionUntil: null, deletedAt: null },
        data: { retentionUntil: new Date("2027-10-30T12:02:00.000Z") },
      },
    },
    {
      operation: "inventoryCommandOutbox.create",
      args: {
        data: {
          commandId: "order-1-release-inventory",
          idempotencyKey: "order-1:RELEASE",
          orderId: "order-1",
          commandType: "RELEASE",
          payload: {},
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: resolvedAt,
        },
      },
    },
  ]);
});

test("does not cancel while refund capture status is unrecorded", async () => {
  const transaction = {
    order: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => ({
        status: "PAYMENT_REVIEW_PENDING",
        cancelRequestedAt: new Date(),
        cancelResolvedAt: null,
        cancelPaymentCaptured: null,
      }),
    },
    inventoryCommandOutbox: {
      create: async () => {
        throw new Error("A RELEASE must not be queued before refund status is recorded");
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);

  assert.equal(
    await repository.resolveCancellationRequest(
      "order-1",
      "admin-1",
      "CANCEL",
      "Cancellation approved.",
      new Date(),
      {
        commandId: "order-1-release-inventory",
        idempotencyKey: "order-1:RELEASE",
        orderId: "order-1",
        commandType: "RELEASE",
        payload: {},
      },
    ),
    "refund-not-recorded",
  );
});
