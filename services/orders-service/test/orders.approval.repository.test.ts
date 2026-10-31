import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { PrismaOrdersRepository } from "../src/prisma.orders.repository.js";
import type { InventoryCommand } from "../src/inventory-command.repository.js";

const command: InventoryCommand = {
  commandId: "order-1-commit-inventory",
  idempotencyKey: "order-1:COMMIT",
  orderId: "order-1",
  commandType: "COMMIT",
  payload: {},
};

function createApprovalRepository(options: {
  transitionCount?: number;
  current?: { status: string; paymentDecision: { decision: "APPROVED" | "REJECTED" } | null } | null;
} = {}) {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
        return { count: options.transitionCount ?? 1 };
      },
      findUnique: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.findUnique", args });
        return options.current ?? null;
      },
    },
    paymentDecision: {
      create: async (args: Record<string, unknown>) => {
        calls.push({ operation: "paymentDecision.create", args });
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

  return {
    repository: new PrismaOrdersRepository(prisma),
    calls,
  };
}

test("approval atomically transitions the order, records the admin, and enqueues commit", async () => {
  const harness = createApprovalRepository();
  const decidedAt = new Date("2026-10-30T12:00:00.000Z");

  const result = await harness.repository.approvePayment(
    "order-1",
    "admin-1",
    decidedAt,
    command,
  );

  assert.equal(result, "approved");
  assert.deepEqual(harness.calls[0], {
    operation: "order.updateMany",
    args: {
      where: {
        orderId: "order-1",
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
    },
  });
  assert.deepEqual(harness.calls[1], {
    operation: "paymentDecision.create",
    args: {
      data: {
        orderId: "order-1",
        decision: "APPROVED",
        adminCustomerId: "admin-1",
        decidedAt,
        reason: null,
      },
    },
  });
  assert.deepEqual(harness.calls[2], {
    operation: "inventoryCommandOutbox.create",
    args: {
      data: {
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        orderId: command.orderId,
        commandType: "COMMIT",
        payload: {},
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: decidedAt,
      },
    },
  });
});

test("approval replay does not add another decision or commit command", async () => {
  const harness = createApprovalRepository({
    transitionCount: 0,
    current: { status: "PAYMENT_APPROVED_FINALIZING", paymentDecision: { decision: "APPROVED" } },
  });

  const result = await harness.repository.approvePayment(
    "order-1",
    "admin-2",
    new Date(),
    command,
  );

  assert.equal(result, "already-approved");
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1]?.operation, "order.findUnique");
});

test("a competing decision or ineligible order does not enqueue a commit", async () => {
  const rejected = createApprovalRepository({
    transitionCount: 0,
    current: { status: "PAYMENT_REVIEW_PENDING", paymentDecision: { decision: "REJECTED" } },
  });
  const expired = createApprovalRepository({
    transitionCount: 0,
    current: { status: "CANCELLED", paymentDecision: null },
  });

  assert.equal(
    await rejected.repository.approvePayment("order-1", "admin-1", new Date(), command),
    "decision-conflict",
  );
  assert.equal(
    await expired.repository.approvePayment("order-1", "admin-1", new Date(), command),
    "not-pending",
  );
  assert.equal(rejected.calls.length, 2);
  assert.equal(expired.calls.length, 2);
});

test("completing the catalog commit confirms the order and completes its outbox claim atomically", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    inventoryCommandOutbox: {
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ operation: "inventoryCommandOutbox.findFirst", args });
        return { commandType: "COMMIT", orderId: "order-1" };
      },
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "inventoryCommandOutbox.updateMany", args });
        return { count: 1 };
      },
    },
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
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);
  const completedAt = new Date("2026-10-30T12:01:00.000Z");

  await repository.markCommandCompleted(command.commandId, "claim-1", completedAt);

  assert.deepEqual(calls, [
    {
      operation: "inventoryCommandOutbox.findFirst",
      args: {
        where: {
          commandId: command.commandId,
          status: "PROCESSING",
          claimToken: "claim-1",
        },
        select: { commandType: true, orderId: true },
      },
    },
    {
      operation: "order.updateMany",
      args: {
        where: { orderId: "order-1", status: "PAYMENT_APPROVED_FINALIZING" },
        data: { status: "CONFIRMED", updatedAt: completedAt },
      },
    },
    {
      operation: "paymentEvidence.updateMany",
      args: {
        where: {
          orderId: "order-1",
          retentionUntil: null,
          deletedAt: null,
        },
        data: { retentionUntil: new Date("2027-10-30T12:01:00.000Z") },
      },
    },
    {
      operation: "inventoryCommandOutbox.updateMany",
      args: {
        where: {
          commandId: command.commandId,
          status: "PROCESSING",
          claimToken: "claim-1",
        },
        data: {
          status: "COMPLETED",
          claimToken: null,
          leaseExpiresAt: null,
          lastError: null,
          completedAt,
        },
      },
    },
  ]);
});

test("rejection atomically transitions pending review, records reason and admin, and enqueues RELEASE", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
        return { count: 1 };
      },
    },
    paymentDecision: {
      create: async (args: Record<string, unknown>) => {
        calls.push({ operation: "paymentDecision.create", args });
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
  const decidedAt = new Date("2026-10-30T12:05:00.000Z");
  const releaseCommand: InventoryCommand = {
    commandId: "order-1-release-inventory",
    idempotencyKey: "order-1:RELEASE",
    orderId: "order-1",
    commandType: "RELEASE",
    payload: {},
  };

  const result = await repository.rejectPayment(
    "order-1",
    "admin-1",
    "El comprobante no corresponde al total del pedido.",
    decidedAt,
    releaseCommand,
  );

  assert.equal(result, "rejected");
  assert.deepEqual(calls, [
    {
      operation: "order.updateMany",
      args: {
        where: {
          orderId: "order-1",
          status: "PAYMENT_REVIEW_PENDING",
          paymentDecision: { is: null },
          paymentEvidence: { isNot: null },
          OR: [
            { cancelRequestedAt: null },
            { cancelResolvedAt: { not: null } },
          ],
        },
        data: { status: "CANCELLED", updatedAt: decidedAt },
      },
    },
    {
      operation: "paymentDecision.create",
      args: {
        data: {
          orderId: "order-1",
          decision: "REJECTED",
          adminCustomerId: "admin-1",
          decidedAt,
          reason: "El comprobante no corresponde al total del pedido.",
        },
      },
    },
    {
      operation: "paymentEvidence.updateMany",
      args: {
        where: { orderId: "order-1", retentionUntil: null, deletedAt: null },
        data: { retentionUntil: new Date("2027-10-30T12:05:00.000Z") },
      },
    },
    {
      operation: "inventoryCommandOutbox.create",
      args: {
        data: {
          commandId: releaseCommand.commandId,
          idempotencyKey: releaseCommand.idempotencyKey,
          orderId: releaseCommand.orderId,
          commandType: "RELEASE",
          payload: {},
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: decidedAt,
        },
      },
    },
  ]);
});

test("rejection replay and approval race never create a second decision or release command", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
        return { count: 0 };
      },
      findUnique: async () => {
        calls.push({ operation: "order.findUnique", args: { where: { orderId: "order-1" } } });
        return {
          status: "PAYMENT_APPROVED_FINALIZING",
          paymentDecision: { decision: "APPROVED" },
        };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);

  const result = await repository.rejectPayment(
    "order-1",
    "admin-2",
    "Prueba",
    new Date(),
    { ...command, commandId: "order-1-release-inventory", idempotencyKey: "order-1:RELEASE", commandType: "RELEASE" },
  );

  assert.equal(result, "decision-conflict");
  assert.equal(calls.length, 2);
});
