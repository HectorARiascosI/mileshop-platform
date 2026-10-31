import assert from "node:assert/strict";
import test from "node:test";

import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";

test("catalog starts with the seeded active product catalog", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());
  const products = await catalog.listProducts();

  assert.equal(products.length, 3);
  assert.deepEqual(products[0], {
    id: "prod-bag-001",
    sku: "MILE-BAG-001",
    name: "Bolso de lona",
    description: "Ligero, resistente y listo para acompañarte.",
    priceCop: 76000,
    stock: 12,
  });
  assert.deepEqual(products.at(-1), {
    id: "prod-mug-001",
    sku: "MILE-MUG-001",
    name: "Taza de cerámica",
    description: "Una taza sencilla para empezar bien el día.",
    priceCop: 28000,
    stock: 24,
  });
});

function createInventoryService(stock = 1): CatalogService {
  return new CatalogService(new InMemoryCatalogStore([
    {
      id: "product-1",
      sku: "SKU-1",
      name: "Product 1",
      description: "",
      priceCop: 100,
      stock,
    },
    {
      id: "product-2",
      sku: "SKU-2",
      name: "Product 2",
      description: "",
      priceCop: 100,
      stock,
    },
  ]));
}

const futureExpiry = (): Date => new Date(Date.now() + 60_000);

test("reserves all lines and treats an identical order retry as idempotent", async () => {
  const service = createInventoryService(2);
  const lines = [
    { productId: "product-1", quantity: 1 },
    { productId: "product-2", quantity: 1 },
  ];

  const first = await service.reserveInventory("order-1", lines, futureExpiry());
  const replay = await service.reserveInventory("order-1", [...lines].reverse(), futureExpiry());

  assert.equal(first.status, "ACTIVE");
  assert.deepEqual(replay, first);
  assert.equal((await service.listProducts())[0]?.stock, 1);
  assert.equal((await service.listProducts())[1]?.stock, 1);
  await assert.rejects(
    () => service.reserveInventory(
      "order-1",
      [{ productId: "product-1", quantity: 2 }],
      futureExpiry(),
    ),
    { code: "CONFLICT" },
  );
});

test("available stock returns on release but remains reduced after commit", async () => {
  const service = createInventoryService(3);

  assert.equal((await service.listProducts())[0]?.stock, 3);
  await service.reserveInventory(
    "order-release",
    [{ productId: "product-1", quantity: 2 }],
    futureExpiry(),
  );
  assert.equal((await service.listProducts())[0]?.stock, 1);
  await service.releaseInventory("order-release");
  assert.equal((await service.listProducts())[0]?.stock, 3);

  await service.reserveInventory(
    "order-commit",
    [{ productId: "product-1", quantity: 2 }],
    futureExpiry(),
  );
  await service.commitInventory("order-commit");
  assert.equal((await service.listProducts())[0]?.stock, 1);
});

test("does not leave a partial reservation when any line is unavailable", async () => {
  const service = createInventoryService(1);

  await assert.rejects(
    () => service.reserveInventory("order-fails", [
      { productId: "product-1", quantity: 1 },
      { productId: "product-2", quantity: 2 },
    ], futureExpiry()),
    { code: "INSUFFICIENT_INVENTORY" },
  );

  const nextOrder = await service.reserveInventory(
    "order-next",
    [{ productId: "product-1", quantity: 1 }],
    futureExpiry(),
  );
  assert.equal(nextOrder.status, "ACTIVE");
});

test("allows only one concurrent reservation for the last unit", async () => {
  const service = createInventoryService(1);
  const results = await Promise.allSettled([
    service.reserveInventory(
      "order-a",
      [{ productId: "product-1", quantity: 1 }],
      futureExpiry(),
    ),
    service.reserveInventory(
      "order-b",
      [{ productId: "product-1", quantity: 1 }],
      futureExpiry(),
    ),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
});

test("commit reduces physical and reserved stock once", async () => {
  const service = createInventoryService(2);
  await service.reserveInventory(
    "order-commit",
    [{ productId: "product-1", quantity: 2 }],
    futureExpiry(),
  );

  const committed = await service.commitInventory("order-commit");
  const replay = await service.commitInventory("order-commit");

  assert.equal(committed.status, "COMMITTED");
  assert.deepEqual(replay, committed);
  await assert.rejects(
    () => service.reserveInventory(
      "order-after-sale",
      [{ productId: "product-1", quantity: 1 }],
      futureExpiry(),
    ),
    { code: "INSUFFICIENT_INVENTORY" },
  );
});

test("release restores reserved stock once and cannot release a committed sale", async () => {
  const service = createInventoryService(1);
  await service.reserveInventory(
    "order-release",
    [{ productId: "product-1", quantity: 1 }],
    futureExpiry(),
  );

  assert.equal((await service.releaseInventory("order-release")).status, "RELEASED");
  assert.equal((await service.releaseInventory("order-release")).status, "RELEASED");
  await service.reserveInventory(
    "order-next",
    [{ productId: "product-1", quantity: 1 }],
    futureExpiry(),
  );
  await service.commitInventory("order-next");
  await assert.rejects(
    () => service.releaseInventory("order-next"),
    { code: "CONFLICT" },
  );
});

test("rejects expired reservations and invalid quantities", async () => {
  const service = createInventoryService(2);

  await assert.rejects(
    () => service.reserveInventory(
      "order-expired",
      [{ productId: "product-1", quantity: 1 }],
      new Date(Date.now() - 1),
    ),
    { code: "INVALID_COMMAND" },
  );
  await assert.rejects(
    () => service.reserveInventory(
      "order-invalid",
      [{ productId: "product-1", quantity: 0 }],
      futureExpiry(),
    ),
    { code: "INVALID_COMMAND" },
  );
});
