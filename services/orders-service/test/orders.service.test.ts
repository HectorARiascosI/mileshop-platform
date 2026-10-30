import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { OrderDomain } from "../src/orders.domain.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import {
  HttpOrderEventPublisher,
  OrdersService,
  type OrderEventPublisher,
} from "../src/orders.service.js";
import type { OrderCreatedEvent } from "../src/orders.types.js";

const catalogProduct: CatalogProduct = {
  id: "p-1",
  sku: "SKU-01",
  name: "Botella térmica",
  description: "Producto de prueba",
  priceCop: 65000,
  stock: 5,
};

const idempotencyKey = "00000000-0000-4000-8000-000000000001";
const orderEvent: OrderCreatedEvent = {
  eventType: "OrderCreated.v1",
  eventId: "order-1-created",
  occurredAt: "2026-10-30T00:00:00.000Z",
  aggregateId: "order-1",
  payload: {
    customerId: "customer-1",
    subtotalCop: 25000,
    deliveryFeeCop: 12000,
    totalCop: 37000,
    currency: "COP",
    lines: [{
      productId: "p-1",
      sku: "SKU-01",
      name: "Botella térmica",
      quantity: 1,
      unitPriceCop: 25000,
    }],
  },
};

function createService(
  repository = new InMemoryOrdersRepository(),
  publisher: OrderEventPublisher = { publishCreated: async () => undefined },
  products: CatalogProduct[] = [catalogProduct],
): OrdersService {
  return new OrdersService(repository, { listActiveProducts: async () => products }, publisher);
}

function createLine(overrides: { quantity?: number; unitPriceCop?: number } = {}) {
  return {
    productId: catalogProduct.id,
    sku: catalogProduct.sku,
    name: catalogProduct.name,
    quantity: overrides.quantity ?? 1,
    unitPriceCop: overrides.unitPriceCop ?? catalogProduct.priceCop,
  };
}

test("creates a valid order and stores its financial totals", async () => {
  const service = createService();
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine({ quantity: 2 })],
  }, idempotencyKey);

  assert.equal(order.subtotalCop, 130000);
  assert.equal(order.deliveryFeeCop, 12000);
  assert.equal(order.totalCop, 142000);
  assert.equal(order.status, "PENDING");
  assert.equal(order.lines.length, 1);

  const persisted = await service.getOrderById(order.orderId);
  assert.equal(persisted?.customerId, "customer-1");
  assert.equal(persisted?.orderId, order.orderId);
  assert.equal(persisted?.subtotalCop, 130000);
});

test("rejects an order without valid lines", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({ customerId: "customer-1", lines: [] }, idempotencyKey),
    { name: "InvalidOrderError" },
  );
});

test("rejects a line with a manipulated price", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      lines: [createLine({ unitPriceCop: 1 })],
    }, idempotencyKey),
    /Product price is not current/,
  );
});

test("uses the catalog name as the persisted line snapshot", async () => {
  const order = await createService().createOrder({
    customerId: "customer-1",
    lines: [{ ...createLine(), name: "Nombre enviado por el cliente" }],
  }, idempotencyKey);

  assert.equal(order.lines[0]?.name, catalogProduct.name);
});

test("rejects a line above the active catalog stock", async () => {
  await assert.rejects(
    () => createService().createOrder({
      customerId: "customer-1",
      lines: [createLine({ quantity: 6 })],
    }, idempotencyKey),
    /Insufficient stock/,
  );
});

test("rejects a product that is not in the active catalog", async () => {
  await assert.rejects(
    () => createService(new InMemoryOrdersRepository(), undefined, []).createOrder({
      customerId: "customer-1",
      lines: [createLine()],
    }, idempotencyKey),
    /Product line is not current/,
  );
});

test("replays the saved order for the same key and payload without republishing", async () => {
  const repository = new InMemoryOrdersRepository();
  let published = 0;
  const service = createService(repository, {
    publishCreated: async () => {
      published += 1;
    },
  });
  const request = { customerId: "customer-1", lines: [createLine()] };

  const first = await service.createOrder(request, idempotencyKey);
  const replay = await service.createOrder(request, idempotencyKey);

  assert.equal(replay.orderId, first.orderId);
  assert.equal(published, 1);
});

test("rejects reuse of an idempotency key with a different payload", async () => {
  const service = createService();
  await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      lines: [createLine({ quantity: 2 })],
    }, idempotencyKey),
    { name: "OrderConflictError" },
  );
});

test("returns the persisted order when event publication fails and schedules retry", async () => {
  const repository = new InMemoryOrdersRepository();
  const service = createService(repository, {
    publishCreated: async () => {
      throw new Error("worker unavailable");
    },
  });

  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);
  const retry = await repository.claimPendingEvents(
    new Date(Date.now() + 6_000),
    30_000,
    25,
  );

  assert.equal(order.orderId.startsWith("order-"), true);
  assert.equal(retry.length, 1);
  assert.equal(retry[0]?.event.aggregateId, order.orderId);
});

test("only one concurrent worker can claim an event and an expired claim is recoverable", async () => {
  const repository = new InMemoryOrdersRepository();
  const service = createService(repository, {
    publishCreated: async () => {
      throw new Error("worker unavailable");
    },
  });
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);

  const now = new Date(Date.now() + 10_000);
  const [first, second] = await Promise.all([
    repository.claimPendingEvents(now, 1_000, 10),
    repository.claimPendingEvents(now, 1_000, 10),
  ]);
  const initialClaim = [...first, ...second][0];
  assert.ok(initialClaim);
  assert.equal(first.length + second.length, 1);

  const recovered = await repository.claimPendingEvents(
    new Date(now.getTime() + 1_001),
    1_000,
    10,
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.event.aggregateId, order.orderId);
  await assert.rejects(
    () => repository.markEventPublished(
      initialClaim.event.eventId,
      initialClaim.claimToken,
      new Date(),
    ),
    /claim lost/,
  );
});

test("builds the domain object with free delivery at the configured threshold", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-2",
    idempotencyKey,
    lines: [
      {
        productId: "p-2",
        sku: "SKU-02",
        name: "Pañal premium",
        quantity: 3,
        unitPriceCop: 50000,
      },
    ],
  });

  assert.equal(record.subtotalCop, 150000);
  assert.equal(record.deliveryFeeCop, 0);
  assert.equal(record.totalCop, 150000);
  assert.equal(record.orderId.startsWith("order-"), true);
});

test("getOrderById returns null for a non-existent order", async () => {
  const result = await createService().getOrderById("order-does-not-exist");
  assert.equal(result, null);
});

test("treats a worker PROCESSING response as retryable, not delivered", async () => {
  const publisher = new HttpOrderEventPublisher(
    async () => new Response(JSON.stringify({ status: "processing" }), { status: 202 }),
    "http://notification-worker.local",
  );

  await assert.rejects(() => publisher.publishCreated(orderEvent), /did not finish event delivery/);
});
