import assert from "node:assert/strict";
import test from "node:test";

import { CatalogClient } from "../src/catalog.client.js";

test("catalog client returns products from the catalog service", async () => {
  const client = new CatalogClient(async () =>
    new Response(JSON.stringify({ data: [{ id: "p1", sku: "SKU-1", name: "Coffee", description: "", priceCop: 9000, stock: 3 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.deepEqual(await client.listProducts(), [
    { id: "p1", sku: "SKU-1", name: "Coffee", description: "", priceCop: 9000, stock: 3 },
  ]);
});

test("catalog client maps upstream failures to service unavailable", async () => {
  const client = new CatalogClient(async () => new Response(null, { status: 503 }));

  await assert.rejects(client.listProducts(), { status: 503 });
});

test("catalog client forwards idempotent manual sales with the internal token", async () => {
  const previousToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
  process.env.CATALOG_INVENTORY_COMMAND_TOKEN = "0123456789abcdef0123456789abcdef";
  let request: { url: string; init?: RequestInit } | undefined;
  try {
    const client = new CatalogClient(async (input, init) => {
      request = { url: input, init };
      return new Response(JSON.stringify({
        data: {
          idempotencyKey: "sale-1",
          adminCustomerId: "admin-1",
          createdAt: "2026-11-01T00:00:00.000Z",
          lines: [],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await client.recordManualSale(
      "admin-1",
      "sale-1",
      [{ productId: "product-1", quantity: 2 }],
    );
    assert.equal(result.idempotencyKey, "sale-1");
    assert.equal(request?.url.endsWith("/internal/admin/manual-sales"), true);
    const headers = new Headers(request?.init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${process.env.CATALOG_INVENTORY_COMMAND_TOKEN}`);
    assert.equal(headers.get("idempotency-key"), "sale-1");
  } finally {
    if (previousToken === undefined) delete process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
    else process.env.CATALOG_INVENTORY_COMMAND_TOKEN = previousToken;
  }
});

test("catalog client authenticates and forwards product and stock administration", async () => {
  const previousToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
  process.env.CATALOG_INVENTORY_COMMAND_TOKEN = "0123456789abcdef0123456789abcdef";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  try {
    const client = new CatalogClient(async (input, init) => {
      requests.push({ url: input, init });
      return new Response(JSON.stringify({ data: { id: "product-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await client.listAdminProducts();
    await client.listCategories();
    await client.createCategory({ name: "Accesorios para moto", theme: "blue" });
    await client.updateCategory("category-1", { name: "Accesorios de moto", theme: "gold" });
    await client.deleteCategory("category-1");
    await client.createProduct({
      sku: "SKU-01",
      name: "Product",
      description: "",
      priceCop: 500,
      imageUrl: null,
      imageFileId: null,
      isActive: true,
    });
    await client.updateProduct("product-1", {
      sku: "SKU-01",
      name: "Product updated",
      description: "",
      priceCop: 600,
      imageUrl: null,
      imageFileId: null,
      isActive: false,
    });
    await client.receiveStock("admin-1", "receipt-1", "Initial delivery", [
      { productId: "product-1", quantity: 3 },
    ]);

    assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
      "/internal/admin/products",
      "/internal/admin/categories",
      "/internal/admin/categories",
      "/internal/admin/categories/category-1",
      "/internal/admin/categories/category-1",
      "/internal/admin/products",
      "/internal/admin/products/product-1",
      "/internal/admin/stock-receipts",
    ]);
    assert.equal(
      JSON.parse(String(requests[5]?.init?.body)).imageFileId,
      null,
    );
    assert.deepEqual(requests.map(({ init }) => init?.method), [
      "GET", "GET", "POST", "PATCH", "DELETE", "POST", "PATCH", "POST",
    ]);
    for (const { init } of requests) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer 0123456789abcdef0123456789abcdef",
      );
    }
    assert.equal(new Headers(requests[7]?.init?.headers).get("idempotency-key"), "receipt-1");
    assert.deepEqual(JSON.parse(String(requests[7]?.init?.body)), {
      adminCustomerId: "admin-1",
      reason: "Initial delivery",
      lines: [{ productId: "product-1", quantity: 3 }],
    });
  } finally {
    if (previousToken === undefined) delete process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
    else process.env.CATALOG_INVENTORY_COMMAND_TOKEN = previousToken;
  }
});
