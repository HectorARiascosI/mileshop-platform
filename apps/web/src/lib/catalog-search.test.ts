import assert from "node:assert/strict";
import test from "node:test";

import { filterCatalogProducts } from "./catalog-search";

const accessoriesCategory = {
  id: "cat-moto",
  name: "Accesorios para moto",
  slug: "accesorios-para-moto",
  theme: "blue" as const,
};

const products = [
  {
    id: "camera",
    name: "Cámara portátil",
    sku: "CAM-001",
    description: "Lente de gran angular",
    categoryId: null,
    category: null,
  },
  {
    id: "lamp",
    name: "Lámpara de mesa",
    sku: "HOG-002",
    description: "Iluminación cálida",
    categoryId: "cat-hogar",
    category: null,
  },
  {
    id: "pitillos",
    name: "Pitillos de radios",
    sku: "MOTO-003",
    description: "Accesorios para ruedas",
    categoryId: accessoriesCategory.id,
    category: accessoriesCategory,
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

test("searches category names and filters by a single category", () => {
  assert.deepEqual(filterCatalogProducts(products, "moto"), [products[2]]);
  assert.deepEqual(filterCatalogProducts(products, "", accessoriesCategory.id), [products[2]]);
});
