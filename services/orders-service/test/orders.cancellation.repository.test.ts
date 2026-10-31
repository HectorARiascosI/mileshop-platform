import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { PrismaOrdersRepository } from "../src/prisma.orders.repository.js";

test("cancels an owner's active reservation and atomically enqueues one RELEASE", async () => {
  const cancelledAt = new Date("2026-10-30T12:00:00.000Z");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
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

  const result = await repository.cancelOrder(
    "order-1",
    "customer-1",
    cancelledAt,
    {
      commandId: "order-1-release-inventory",
      idempotencyKey: "order-1:RELEASE",
      orderId: "order-1",
      commandType: "RELEASE",
      payload: {},
    },
  );

  assert.equal(result, "cancelled");
  assert.deepEqual(calls, [
    {
      operation: "order.updateMany",
      args: {
        where: {
          orderId: "order-1",
          customerId: "customer-1",
          status: "AWAITING_PAYMENT_PROOF",
          reservationExpiresAt: { gt: cancelledAt },
          paymentDecision: { is: null },
          paymentEvidence: { is: null },
        },
        data: { status: "CANCELLED", updatedAt: cancelledAt },
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
          nextAttemptAt: cancelledAt,
        },
      },
    },
  ]);
});

test("returns idempotent and ineligible results without creating another release", async () => {
  let releaseCommands = 0;
  let currentOrder: Record<string, unknown> | null = {
    status: "CANCELLED",
    customerId: "customer-1",
    paymentDecision: null,
  };
  const transaction = {
    order: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => currentOrder,
    },
    inventoryCommandOutbox: {
      create: async () => {
        releaseCommands += 1;
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
    await repository.cancelOrder("order-1", "customer-1", new Date(), releaseCommand),
    "already-cancelled",
  );
  currentOrder = {
    status: "PAYMENT_REVIEW_PENDING",
    customerId: "customer-1",
    paymentDecision: null,
  };
  assert.equal(
    await repository.cancelOrder("order-1", "customer-1", new Date(), releaseCommand),
    "not-cancellable",
  );
  currentOrder = null;
  assert.equal(
    await repository.cancelOrder("order-1", "customer-2", new Date(), releaseCommand),
    "not-found",
  );
  assert.equal(releaseCommands, 0);
});
