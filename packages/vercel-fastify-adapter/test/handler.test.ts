import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import Fastify from "fastify";

import { handleFastifyRequest } from "../src/index.js";

test("forwards Vercel API requests to Fastify without the /api prefix", async () => {
  const app = Fastify();
  app.post("/orders", async (request) => ({
    body: request.body,
    query: request.query,
  }));
  await app.ready();

  const server = createServer((request, response) => {
    void handleFastifyRequest(app, request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/orders?source=vercel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: "p-1", quantity: 2 }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      body: { productId: "p-1", quantity: 2 },
      query: { source: "vercel" },
    });
  } finally {
    server.close();
    await once(server, "close");
    await app.close();
  }
});

test("restores multi-segment paths rewritten to the shared Vercel handler", async () => {
  const app = Fastify();
  app.get("/catalog/products", async (request) => ({
    path: request.url,
    query: request.query,
  }));
  await app.ready();

  const server = createServer((request, response) => {
    void handleFastifyRequest(app, request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/handler?mileshopPath=catalog%2Fproducts&source=vercel`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      path: "/catalog/products?source=vercel",
      query: { source: "vercel" },
    });
  } finally {
    server.close();
    await once(server, "close");
    await app.close();
  }
});

test("rejects request bodies above the Vercel Function limit", async () => {
  const app = Fastify();
  await app.ready();
  const server = createServer((request, response) => {
    void handleFastifyRequest(app, request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/orders`, {
      method: "POST",
      body: "x".repeat(4_500_001),
    });
    assert.equal(response.status, 413);
  } finally {
    server.close();
    await once(server, "close");
    await app.close();
  }
});
