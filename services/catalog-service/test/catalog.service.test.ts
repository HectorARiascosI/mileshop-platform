import test from "node:test";
import assert from "node:assert/strict";

import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";

test("catalog starts with the seeded active product catalog", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());
  const products = await catalog.listProducts();

  assert.equal(products.length, 4);
  assert.deepEqual(products[0], {
    id: "prod-mug-001",
    sku: "MILE-MUG-001",
    name: "Taza de cerámica",
    description: "Una taza sencilla para empezar bien el día.",
    priceCop: 28000,
    stock: 24,
  });
  assert.deepEqual(products.at(-1), {
    id: "prod-bottle-001",
    sku: "MILE-BTL-001",
    name: "Botella térmica",
    description: "Mantén tus bebidas a temperatura ideal durante todo el día.",
    priceCop: 52000,
    stock: 17,
  });
});
