import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import {
  InMemoryOrderEventOutbox,
  OrdersService,
} from "../src/orders.service.js";

const product: CatalogProduct = {
  id: "product-recovery",
  sku: "REC-001",
  name: "Recovery product",
  description: "Test fixture",
  priceCop: 1200,
  stock: 5,
};

test("recovers an intent after catalog reserve succeeds but order persistence fails", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  let completionAttempts = 0;
  class FailingOnceRepository extends InMemoryOrdersRepository {
    public override async completeReservationIntent(
      intent: Parameters<InMemoryOrdersRepository["completeReservationIntent"]>[0],
      record: Parameters<InMemoryOrdersRepository["completeReservationIntent"]>[1],
      event: Parameters<InMemoryOrdersRepository["completeReservationIntent"]>[2],
    ): Promise<void> {
      completionAttempts += 1;
      if (completionAttempts === 1) {
        throw new Error("temporary order database failure");
      }
      await super.completeReservationIntent(intent, record, event);
    }
  }

  const repository = new FailingOnceRepository(outbox);
  const persistedReservations = new Map<string, {
    orderId: string;
    status: "RESERVED";
    reservedAt: string;
    lines: Array<{
      productId: string;
      sku: string;
      name: string;
      quantity: number;
      unitPriceCop: number;
    }>;
  }>();
  let catalogReservationCommits = 0;
  const service = new OrdersService(
    repository,
    {
      listActiveProducts: async () => [product],
      reserveProducts: async (orderId, requestedLines) => {
        const existing = persistedReservations.get(orderId);
        if (existing) {
          return structuredClone(existing);
        }

        catalogReservationCommits += 1;
        const reservation = {
          orderId,
          status: "RESERVED" as const,
          reservedAt: new Date().toISOString(),
          lines: requestedLines.map((line) => ({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            quantity: line.quantity,
            unitPriceCop: product.priceCop,
          })),
        };
        persistedReservations.set(orderId, reservation);
        return structuredClone(reservation);
      },
    },
    { publishCreated: async () => {} },
    outbox,
  );
  const command = {
    customerId: "customer-recovery",
    idempotencyKey: "00000000-0000-4000-8000-000000000091",
    lines: [{
      productId: product.id,
      sku: "client-value-is-ignored",
      name: "Client value is ignored",
      quantity: 2,
      unitPriceCop: 1,
    }],
  };

  await assert.rejects(() => service.createOrder(command));
  assert.equal(catalogReservationCommits, 1);
  assert.equal(await repository.findByIdempotencyKey(command.idempotencyKey), null);

  await service.recoverPendingReservationIntents(new Date(Date.now() + 60_000));
  const order = await repository.findByIdempotencyKey(command.idempotencyKey);

  assert.equal(order?.lines[0]?.name, product.name);
  assert.equal(order?.lines[0]?.unitPriceCop, product.priceCop);
  assert.equal(order?.lines[0]?.quantity, 2);
  assert.equal(catalogReservationCommits, 1);
  assert.equal(completionAttempts, 2);
});

test("rejects reusing a customer idempotency key with a different cart", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const repository = new InMemoryOrdersRepository(outbox);
  const service = new OrdersService(
    repository,
    {
      listActiveProducts: async () => [product],
      reserveProducts: async (orderId, lines) => ({
        orderId,
        status: "RESERVED",
        reservedAt: new Date().toISOString(),
        lines: lines.map((line) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPriceCop: product.priceCop,
        })),
      }),
    },
    { publishCreated: async () => {} },
    outbox,
  );
  const command = {
    customerId: "customer-recovery",
    idempotencyKey: "00000000-0000-4000-8000-000000000092",
    lines: [{
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unitPriceCop: product.priceCop,
    }],
  };
  await service.createOrder(command);

  await assert.rejects(
    () => service.createOrder({
      ...command,
      lines: [{ ...command.lines[0]!, quantity: 2 }],
    }),
    /Idempotency key has already been used/,
  );
});
