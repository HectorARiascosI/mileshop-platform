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
