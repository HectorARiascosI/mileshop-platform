import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { OrderDomain } from "../src/orders.domain.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import { OrdersService } from "../src/orders.service.js";

const catalogProduct: CatalogProduct = {
  id: "p-1",
  sku: "SKU-01",
  name: "Botella térmica",
  description: "Producto de prueba",
  priceCop: 65000,
  stock: 5,
};

function createService(products: CatalogProduct[] = [catalogProduct]): OrdersService {
  return new OrdersService(
    new InMemoryOrdersRepository(),
    { listActiveProducts: async () => products },
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
  const service = createService();

  await assert.rejects(
    () =>
      service.createOrder({
        customerId: "customer-1",
        lines: [],
      }),
    /Invalid order payload|Order must include at least one valid line/,
  );
});

test("rejects a line with a manipulated price", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      lines: [createLine({ unitPriceCop: 1 })],
    }),
    /Product price is not current/,
  );
});

test("uses the catalog name as the persisted line snapshot", async () => {
  const service = createService();

  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [{ ...createLine(), name: "Nombre enviado por el cliente" }],
  });

  assert.equal(order.lines[0]?.name, catalogProduct.name);
});

test("rejects a line above the active catalog stock", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
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
      lines: [createLine()],
    }),
    /Product line is not current/,
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

test("orderId is a UUID-based string", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-uuid-test",
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

test("getOrderById returns null for a non-existent order", async () => {
  const service = createService();

  // null from getOrderById is translated to HTTP 404 by the controller (OrdersController.getOrder)
  const result = await service.getOrderById("order-does-not-exist");
  assert.equal(result, null);
});
