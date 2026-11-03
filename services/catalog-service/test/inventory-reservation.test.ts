import assert from "node:assert/strict";
import test from "node:test";

import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";

const mug = {
  productId: "prod-mug-001",
  quantity: 1,
};

test("reserves every requested product or none when one line is unavailable", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());

  await assert.rejects(
    () => catalog.reserveProducts("order-atomic", [
      mug,
      { productId: "missing-product", quantity: 1 },
    ]),
    /Product is not available/,
  );

  const products = await catalog.listProducts();
  assert.equal(products.find((product) => product.id === mug.productId)?.stock, 24);

  const laterReservation = await catalog.reserveProducts("order-atomic", [mug]);
  assert.equal(laterReservation.lines.length, 1);
});

test("concurrent reservations cannot sell more than the last available stock", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());
  const request = [{ productId: mug.productId, quantity: 20 }];
  const outcomes = await Promise.allSettled([
    catalog.reserveProducts("order-last-stock-a", request),
    catalog.reserveProducts("order-last-stock-b", request),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(
    (await catalog.listProducts()).find((product) => product.id === mug.productId)?.stock,
    4,
  );
});

test("reservation retries are idempotent and reject a changed request", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());
  const first = await catalog.reserveProducts("order-idempotent", [
    { productId: mug.productId, quantity: 2 },
  ]);
  const retry = await catalog.reserveProducts("order-idempotent", [
    { productId: mug.productId, quantity: 2 },
  ]);

  assert.deepEqual(retry, first);
  assert.equal(
    (await catalog.listProducts()).find((product) => product.id === mug.productId)?.stock,
    22,
  );

  await assert.rejects(
    () => catalog.reserveProducts("order-idempotent", [
      { productId: mug.productId, quantity: 3 },
    ]),
    /Reservation idempotency key was reused/,
  );
  assert.equal(
    (await catalog.listProducts()).find((product) => product.id === mug.productId)?.stock,
    22,
  );
});
