import assert from "node:assert/strict";
import test from "node:test";

import { filterCatalogProducts } from "./catalog-search";

const products = [
  {
    id: "camera",
    name: "Cámara portátil",
    sku: "CAM-001",
    description: "Lente de gran angular",
  },
  {
    id: "lamp",
    name: "Lámpara de mesa",
    sku: "HOG-002",
    description: "Iluminación cálida",
  },
];

test("searches product names without requiring accent marks", () => {
  assert.deepEqual(filterCatalogProducts(products, "camara"), [products[0]]);
});

test("searches product codes and descriptions without case sensitivity", () => {
  assert.deepEqual(filterCatalogProducts(products, " hog-002 "), [products[1]]);
  assert.deepEqual(filterCatalogProducts(products, "CALIDA"), [products[1]]);
});

test("returns all products for a blank query", () => {
  assert.deepEqual(filterCatalogProducts(products, "  "), products);
});
