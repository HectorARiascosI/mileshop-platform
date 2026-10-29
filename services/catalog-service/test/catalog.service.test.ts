import test from "node:test";
import assert from "node:assert/strict";

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
