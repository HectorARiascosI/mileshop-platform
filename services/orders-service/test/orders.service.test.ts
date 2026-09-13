import assert from "node:assert/strict";
import test from "node:test";

import { OrderDomain } from "../src/orders.domain.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import { OrdersService } from "../src/orders.service.js";

test("creates a valid order and stores it by orderId", async () => {
  const repo = new InMemoryOrdersRepository();
  const service = new OrdersService(repo);

  const order = await service.createOrder({
    customerId: "customer-1",
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

  assert.equal(order.totalCop, 130000);
  assert.equal(order.status, "PENDING");
  assert.equal(order.lines.length, 1);

  const persisted = await service.getOrderById(order.orderId);
  assert.equal(persisted?.customerId, "customer-1");
  assert.equal(persisted?.orderId, order.orderId);
});

test("rejects an order without valid lines", async () => {
  const repo = new InMemoryOrdersRepository();
  const service = new OrdersService(repo);

  await assert.rejects(
    () =>
      service.createOrder({
        customerId: "customer-1",
        lines: [],
      }),
    /Invalid order payload|Order must include at least one valid line/,
  );
});

test("builds the domain object with subtotal and order id", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-2",
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

  assert.equal(record.totalCop, 42000);
  assert.equal(record.orderId.startsWith("order-"), true);
  assert.equal(record.lines[0]?.sku, "SKU-02");
});
