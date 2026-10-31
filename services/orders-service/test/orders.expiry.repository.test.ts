import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "../generated/orders-client/index.js";
import { PrismaOrdersRepository } from "../src/prisma.orders.repository.js";

test("expires only due unsubmitted orders and atomically enqueues one RELEASE", async () => {
  const now = new Date("2026-10-30T18:00:00.000Z");
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  let transition = 0;
  const transaction = {
    order: {
      updateMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.updateMany", args });
        transition += 1;
        return { count: transition === 1 ? 1 : 0 };
      },
    },
    inventoryCommandOutbox: {
      create: async (args: Record<string, unknown>) => {
        calls.push({ operation: "inventoryCommandOutbox.create", args });
      },
    },
  };
  const prisma = {
    order: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ operation: "order.findMany", args });
        return [{ orderId: "order-due" }, { orderId: "order-raced" }];
      },
    },
    $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);

  const expiredCount = await repository.expireDueOrders(now, 25);

  assert.equal(expiredCount, 1);
  assert.deepEqual(calls[0], {
    operation: "order.findMany",
    args: {
      where: {
        status: "AWAITING_PAYMENT_PROOF",
        reservationExpiresAt: { lte: now },
        paymentDecision: { is: null },
        paymentEvidence: { is: null },
      },
      orderBy: [{ reservationExpiresAt: "asc" }, { orderId: "asc" }],
      take: 25,
      select: { orderId: true },
    },
  });
  assert.deepEqual(calls[1], {
    operation: "order.updateMany",
    args: {
      where: {
        orderId: "order-due",
        status: "AWAITING_PAYMENT_PROOF",
        reservationExpiresAt: { lte: now },
        paymentDecision: { is: null },
        paymentEvidence: { is: null },
      },
      data: { status: "RESERVATION_EXPIRED", updatedAt: now },
    },
  });
  assert.deepEqual(calls[2], {
    operation: "inventoryCommandOutbox.create",
    args: {
      data: {
        commandId: "order-due-release-inventory",
        idempotencyKey: "order-due:RELEASE",
        orderId: "order-due",
        commandType: "RELEASE",
        payload: {},
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: now,
      },
    },
  });
  assert.deepEqual(calls[3], {
    operation: "order.updateMany",
    args: {
      where: {
        orderId: "order-raced",
        status: "AWAITING_PAYMENT_PROOF",
        reservationExpiresAt: { lte: now },
        paymentDecision: { is: null },
        paymentEvidence: { is: null },
      },
      data: { status: "RESERVATION_EXPIRED", updatedAt: now },
    },
  });
  assert.equal(calls.length, 4);
});

test("does not expire an order with a timely proof or before its deadline", async () => {
  let findManyArgs: Record<string, unknown> | undefined;
  const prisma = {
    order: {
      findMany: async (args: Record<string, unknown>) => {
        findManyArgs = args;
        return [];
      },
    },
  } as unknown as PrismaClient;
  const repository = new PrismaOrdersRepository(prisma);

  assert.equal(await repository.expireDueOrders(new Date(), 10), 0);
  const where = findManyArgs?.where as {
    status: string;
    reservationExpiresAt: { lte: Date };
    paymentDecision: { is: null };
    paymentEvidence: { is: null };
  };
  assert.equal(where.status, "AWAITING_PAYMENT_PROOF");
  assert.ok(where.reservationExpiresAt.lte instanceof Date);
  assert.deepEqual(where.paymentDecision, { is: null });
  assert.deepEqual(where.paymentEvidence, { is: null });
});
