import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";

import { CatalogController } from "../src/catalog.controller.js";
import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";
import { InventoryCommandGuard } from "../src/inventory-command.guard.js";

test("GET /products returns available stock without changing its response shape", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore([{
    id: "product-1",
    sku: "SKU-1",
    name: "Product 1",
    description: "",
    priceCop: 100,
    stock: 3,
  }]));
  await catalog.reserveInventory(
    "order-1",
    [{ productId: "product-1", quantity: 2 }],
    new Date(Date.now() + 60_000),
  );

  class CatalogHttpTestModule {}
  Module({
    controllers: [CatalogController],
    providers: [
      { provide: "CATALOG_SERVICE", useValue: catalog },
      InventoryCommandGuard,
    ],
  })(CatalogHttpTestModule);

  const app = await NestFactory.create(
    CatalogHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const response = await fetch(`${await app.getUrl()}/products`);

    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(payload !== null && typeof payload === "object" && "data" in payload);
    assert.ok(Array.isArray(payload.data));
    assert.deepEqual(payload.data[0], {
      id: "product-1",
      sku: "SKU-1",
      name: "Product 1",
      description: "",
      priceCop: 100,
      stock: 1,
    });
  } finally {
    await app.close();
  }
});
