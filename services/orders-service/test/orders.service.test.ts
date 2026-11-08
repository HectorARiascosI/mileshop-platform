import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { ORDER_RESERVATION_TTL_MS, OrderDomain } from "../src/orders.domain.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import {
  InMemoryOrderEventOutbox,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_RETRY_BASE_DELAY_MS,
  OUTBOX_RETRY_MAX_DELAY_MS,
  OrdersService,
} from "../src/orders.service.js";

const catalogProduct: CatalogProduct = {
  id: "p-1",
  sku: "SKU-01",
  name: "Botella térmica",
  description: "Producto de prueba",
  priceCop: 65000,
  stock: 5,
};

function createService(products: CatalogProduct[] = [catalogProduct]): OrdersService {
  const outbox = new InMemoryOrderEventOutbox();
  const availableById = new Map(products.map((product) => [product.id, product.stock]));
  const reservations = new Map<string, {
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
  return new OrdersService(
    new InMemoryOrdersRepository(outbox),
    {
      listActiveProducts: async () => products,
      reserveProducts: async (orderId, requestedLines) => {
        const existing = reservations.get(orderId);
        if (existing) {
          return structuredClone(existing);
        }

        const aggregated = new Map<string, number>();
        for (const line of requestedLines) {
          aggregated.set(line.productId, (aggregated.get(line.productId) ?? 0) + line.quantity);
        }

        const reservedLines = [...aggregated.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([productId, quantity]) => {
            const product = products.find((candidate) => candidate.id === productId);
            if (!product || (availableById.get(productId) ?? 0) < quantity) {
              throw new Error(`Insufficient stock: ${productId}`);
            }
            return {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              quantity,
              unitPriceCop: product.priceCop,
            };
          });

        for (const line of reservedLines) {
          availableById.set(line.productId, (availableById.get(line.productId) ?? 0) - line.quantity);
        }

        const reservation = {
          orderId,
          status: "RESERVED" as const,
          reservedAt: new Date().toISOString(),
          lines: reservedLines,
        };
        reservations.set(orderId, reservation);
        return structuredClone(reservation);
      },
    },
    {
      publishCreated: async () => {},
    },
    outbox,
  );
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

test("creates a valid order and stores it by orderId", async () => {
  const service = createService();

  const order = await service.createOrder({
    customerId: "customer-1",
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    lines: [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        quantity: 2,
        unitPriceCop: 65000,
      },
    ],
  });

  test("admin queue lists WhatsApp orders and confirmation accepts awaiting proof", async () => {
    const service = createService();
    const order = await service.createOrder({
      customerId: "customer-1",
      idempotencyKey: "00000000-0000-4000-8000-000000000099",
      lines: [createLine()],
    });

    const pending = await service.listPendingAdminOrders();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.orderId, order.orderId);
    assert.equal(pending[0]?.status, "AWAITING_PAYMENT_PROOF");

    const decision = await service.approvePayment(order.orderId, "admin-1");
    assert.equal(decision.result, "approved");
    assert.equal(decision.order?.status, "PAYMENT_APPROVED_FINALIZING");
    assert.equal((await service.listPendingAdminOrders()).length, 0);
  });

  assert.equal(order.subtotalCop, 130000);
  assert.equal(order.deliveryFeeCop, 0);
  assert.equal(order.totalCop, 130000);
  assert.equal(order.status, "AWAITING_PAYMENT_PROOF");
  assert.equal(order.lines.length, 1);

  const persisted = await service.getOrderById(order.orderId);
  assert.equal(persisted?.customerId, "customer-1");
  assert.equal(persisted?.orderId, order.orderId);
});

test("checks repository connectivity for readiness", async () => {
  let checks = 0;
  const repository = new InMemoryOrdersRepository();
  repository.checkConnectivity = async () => {
    checks += 1;
  };
  const service = new OrdersService(
    repository,
    { listActiveProducts: async () => [catalogProduct] },
    { publishCreated: async () => {} },
  );

  await service.checkReadiness();

  assert.equal(checks, 1);
});

test("holds an order after an admin records a payment report", async () => {
  const service = createService();
  const created = await service.createOrder({
    customerId: "customer-payment-reported",
    idempotencyKey: "00000000-0000-4000-8000-000000000099",
    lines: [createLine()],
  });

  const result = await service.markPaymentReported(created.orderId, "store-admin-1");
  const persisted = await service.getOrderById(created.orderId);

  assert.equal(result.result, "marked");
  assert.ok(persisted?.paymentReportedAt);
  assert.equal(
    (await service.markPaymentReported(created.orderId, "store-admin-1")).result,
    "already-reported",
  );
});

test("returns the updated order after a customer cancels it", async () => {
  const service = createService();
  const created = await service.createOrder({
    customerId: "customer-cancel",
    idempotencyKey: "00000000-0000-4000-8000-000000000098",
    lines: [createLine()],
  });

  const result = await service.cancelOrder(created.orderId, "customer-cancel");

  assert.equal(result.result, "cancelled");
  assert.equal(result.order?.orderId, created.orderId);
  assert.equal(result.order?.status, "CANCELLED");
  assert.equal(result.order?.paymentDecision, null);
});

test("writes the created event into the outbox before publishing", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const service = new OrdersService(
    new InMemoryOrdersRepository(outbox),
    { listActiveProducts: async () => [catalogProduct] },
    {
      publishCreated: async () => {
        throw new Error("worker offline");
      },
    },
    outbox,
  );

  const created = await service.createOrder({
    customerId: "customer-1",
    idempotencyKey: "00000000-0000-4000-8000-000000000002",
    lines: [createLine()],
  });

  const pendingOrder = await service.getOrderById(created.orderId);
  assert.equal(pendingOrder?.status, "RESERVING_INVENTORY");
  const pending = await outbox.listPending(new Date(Date.now() + OUTBOX_RETRY_BASE_DELAY_MS + 1));
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.event.eventType, "OrderCreated.v1");
  assert.equal(pending[0]?.event.payload.deliveryFeeCop, 0);
  assert.equal(pending[0]?.attemptCount, 1);
});

test("does not persist an order when its outbox event cannot be saved", async () => {
  const repository = new InMemoryOrdersRepository({
    append: async () => {
      throw new Error("outbox persistence failed");
    },
  });
  const service = new OrdersService(
    repository,
    { listActiveProducts: async () => [catalogProduct] },
    { publishCreated: async () => {} },
  );
  const idempotencyKey = "00000000-0000-4000-8000-000000000011";

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      idempotencyKey,
      lines: [createLine()],
    }),
    /outbox persistence failed/,
  );
  assert.equal(await repository.findByIdempotencyKey(idempotencyKey), null);
});

test("recovers pending outbox events on startup when the worker is available again", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const event = {
    eventType: "OrderCreated.v1",
    eventId: "event-recovery-1",
    occurredAt: new Date().toISOString(),
    aggregateId: "order-123",
    payload: {
      customerId: "customer-1",
      subtotalCop: 1000,
      deliveryFeeCop: 0,
      totalCop: 1000,
      currency: "COP",
      lines: [
        {
          productId: "p-1",
          sku: "SKU-01",
          name: "Botella térmica",
          quantity: 1,
          unitPriceCop: 1000,
        },
      ],
    },
  } satisfies Awaited<ReturnType<InMemoryOrderEventOutbox["listPending"]>>[number]["event"];

  await outbox.append(event);

  let published = 0;
  const service = new OrdersService(
    new InMemoryOrdersRepository(outbox),
    { listActiveProducts: async () => [catalogProduct] },
    {
      publishCreated: async () => {
        published += 1;
      },
    },
    outbox,
  );

  await service.recoverPendingEvents();

  assert.equal(published, 1);
  assert.deepEqual((await outbox.listPending()).map((item) => item.event.eventId), []);
});

test("schedules outbox retries with capped exponential backoff", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const event = {
    eventType: "OrderCreated.v1",
    eventId: "event-backoff-1",
    occurredAt: new Date().toISOString(),
    aggregateId: "order-456",
    payload: {
      customerId: "customer-1",
      subtotalCop: 1000,
      deliveryFeeCop: 0,
      totalCop: 1000,
      currency: "COP",
      lines: [],
    },
  } satisfies Awaited<ReturnType<InMemoryOrderEventOutbox["listPending"]>>[number]["event"];
  await outbox.append(event);

  let failedAt = new Date("2026-10-29T20:00:00.000Z");
  for (let attempt = 1; attempt < OUTBOX_MAX_ATTEMPTS; attempt += 1) {
    const result = await outbox.markFailed(event.eventId, "worker offline", failedAt);
    const expectedDelay = Math.min(
      OUTBOX_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
      OUTBOX_RETRY_MAX_DELAY_MS,
    );

    assert.equal(result.attemptCount, attempt);
    assert.equal(result.nextAttemptAt?.getTime(), failedAt.getTime() + expectedDelay);
    assert.equal((await outbox.listPending(failedAt)).length, 0);
    assert.equal((await outbox.listPending(result.nextAttemptAt!)).length, 1);
    failedAt = result.nextAttemptAt!;
  }
});

test("stops scheduling outbox retries after the maximum attempts", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const event = {
    eventType: "OrderCreated.v1",
    eventId: "event-backoff-terminal",
    occurredAt: new Date().toISOString(),
    aggregateId: "order-789",
    payload: {
      customerId: "customer-1",
      subtotalCop: 1000,
      deliveryFeeCop: 0,
      totalCop: 1000,
      currency: "COP",
      lines: [],
    },
  } satisfies Awaited<ReturnType<InMemoryOrderEventOutbox["listPending"]>>[number]["event"];
  await outbox.append(event);

  let failedAt = new Date("2026-10-29T20:00:00.000Z");
  for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
    const result = await outbox.markFailed(event.eventId, "worker offline", failedAt);
    assert.equal(result.attemptCount, attempt);

    if (attempt === OUTBOX_MAX_ATTEMPTS) {
      assert.equal(result.nextAttemptAt, null);
      assert.equal((await outbox.listPending(new Date("2027-01-01T00:00:00.000Z"))).length, 0);
    } else {
      assert.ok(result.nextAttemptAt);
      failedAt = result.nextAttemptAt;
    }
  }
});

test("reuses the persisted order and event for an idempotent retry", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const repository = new InMemoryOrdersRepository(outbox);
  let published = 0;
  const service = new OrdersService(
    repository,
    { listActiveProducts: async () => [catalogProduct] },
    { publishCreated: async () => { published += 1; } },
    outbox,
  );
  const command = {
    customerId: "customer-1",
    idempotencyKey: "00000000-0000-4000-8000-000000000003",
    lines: [createLine()],
  };

  const first = await service.createOrder(command);
  const retry = await service.createOrder(command);

  assert.equal(retry.orderId, first.orderId);
  assert.deepEqual(retry.event, first.event);
  assert.equal(published, 1);
});

test("rejects reusing an idempotency key for another customer", async () => {
  const service = createService();
  const idempotencyKey = "00000000-0000-4000-8000-000000000004";

  await service.createOrder({
    customerId: "customer-1",
    idempotencyKey,
    lines: [createLine()],
  });

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-2",
      idempotencyKey,
      lines: [createLine()],
    }),
    { name: "ConflictException" },
  );
});

test("rejects an order without valid lines", async () => {
  const service = createService();

  await assert.rejects(
    () =>
      service.createOrder({
        customerId: "customer-1",
        idempotencyKey: "00000000-0000-4000-8000-000000000005",
        lines: [],
      }),
    /Invalid order payload|Order must include at least one valid line/,
  );
});

test("uses catalog-owned price when the client submits a manipulated price", async () => {
  const service = createService();

  const order = await service.createOrder({
      customerId: "customer-1",
      idempotencyKey: "00000000-0000-4000-8000-000000000006",
      lines: [createLine({ unitPriceCop: 1 })],
    });

  assert.equal(order.lines[0]?.unitPriceCop, catalogProduct.priceCop);
  assert.equal(order.subtotalCop, catalogProduct.priceCop);
});

test("persists the catalog reservation price and recalculates order totals and event", async () => {
  const outbox = new InMemoryOrderEventOutbox();
  const service = new OrdersService(
    new InMemoryOrdersRepository(outbox),
    {
      listActiveProducts: async () => [catalogProduct],
      reserveProducts: async (orderId, lines) => ({
        orderId,
        status: "RESERVED",
        reservedAt: new Date().toISOString(),
        lines: lines.map((line) => ({
          productId: catalogProduct.id,
          sku: "SKU-01-UPDATED",
          name: "Botella térmica actualizada",
          quantity: line.quantity,
          unitPriceCop: 52000,
        })),
      }),
    },
    { publishCreated: async () => {} },
    outbox,
  );
  const order = await service.createOrder({
    customerId: "customer-promotion",
    idempotencyKey: "00000000-0000-4000-8000-000000000088",
    lines: [createLine({ quantity: 2, unitPriceCop: 1 })],
  });

  assert.equal(order.lines[0]?.sku, "SKU-01-UPDATED");
  assert.equal(order.lines[0]?.name, "Botella térmica actualizada");
  assert.equal(order.lines[0]?.unitPriceCop, 52000);
  assert.equal(order.subtotalCop, 104000);
  assert.equal(order.deliveryFeeCop, 0);
  assert.equal(order.totalCop, 104000);
  assert.equal(order.event?.payload.lines[0]?.unitPriceCop, 52000);
  assert.equal(order.event?.payload.totalCop, 104000);
  assert.ok(order.reservationExpiresAt);
  assert.equal(
    order.reservationExpiresAt.getTime() - Date.parse(order.createdAt),
    ORDER_RESERVATION_TTL_MS,
  );
  const persisted = await service.getOrderById(order.orderId);
  assert.equal(persisted?.lines[0]?.unitPriceCop, 52000);
  assert.equal(persisted?.reservationExpiresAt?.getTime(), order.reservationExpiresAt.getTime());
  assert.equal(persisted?.totalCop, 104000);
});

test("uses the catalog name as the persisted line snapshot", async () => {
  const service = createService();

  const order = await service.createOrder({
    customerId: "customer-1",
    idempotencyKey: "00000000-0000-4000-8000-000000000007",
    lines: [{ ...createLine(), name: "Nombre enviado por el cliente" }],
  });

  assert.equal(order.lines[0]?.name, catalogProduct.name);
});

test("rejects a line above the active catalog stock", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      idempotencyKey: "00000000-0000-4000-8000-000000000008",
      lines: [createLine({ quantity: 6 })],
    }),
    /Insufficient stock/,
  );
});

test("rejects a product that is not in the active catalog", async () => {
  const service = createService([]);

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      idempotencyKey: "00000000-0000-4000-8000-000000000009",
      lines: [createLine()],
    }),
    /Product line is not current/,
  );
});

test("builds the domain object with subtotal and order id", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-2",
    idempotencyKey: "00000000-0000-4000-8000-000000000010",
    lines: [
      {
        productId: "p-2",
        sku: "SKU-02",
        name: "Pañal premium",
        quantity: 1,
        unitPriceCop: 42000,
      },
    ],
  });

  assert.equal(record.subtotalCop, 42000);
  assert.equal(record.deliveryFeeCop, 0);
  assert.equal(record.totalCop, 42000);
  assert.equal(record.orderId.startsWith("order-"), true);
  assert.equal(record.lines[0]?.sku, "SKU-02");
});

test("orderId is a UUID-based string", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-uuid-test",
    idempotencyKey: "00000000-0000-4000-8000-000000000011",
    lines: [
      {
        productId: "p-3",
        sku: "SKU-03",
        name: "Producto UUID",
        quantity: 1,
        unitPriceCop: 10000,
      },
    ],
  });

  const uuidPattern = /^order-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(record.orderId, uuidPattern);
});

test("charges $7,000 just below $12,000 and waives delivery at the threshold", () => {
  const belowThreshold = OrderDomain.createOrder({
    customerId: "customer-shipping",
    idempotencyKey: "00000000-0000-4000-8000-000000000013",
    lines: [{
      productId: "p-4",
      sku: "SKU-04",
      name: "Producto límite",
      quantity: 1,
      unitPriceCop: 11_999,
    }],
  });
  assert.equal(belowThreshold.deliveryFeeCop, 7_000);
  assert.equal(belowThreshold.totalCop, 18_999);

  const record = OrderDomain.createOrder({
    customerId: "customer-shipping",
    idempotencyKey: "00000000-0000-4000-8000-000000000012",
    lines: [
      {
        productId: "p-4",
        sku: "SKU-04",
        name: "Producto límite",
        quantity: 3,
        unitPriceCop: 4000,
      },
    ],
  });

  assert.equal(record.subtotalCop, 12000);
  assert.equal(record.deliveryFeeCop, 0);
  assert.equal(record.totalCop, 12000);
});

test("getOrderById returns null for a non-existent order", async () => {
  const service = createService();

  // null from getOrderById is translated to HTTP 404 by the controller (OrdersController.getOrder)
  const result = await service.getOrderById("order-does-not-exist");
  assert.equal(result, null);
});
