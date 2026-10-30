import assert from "node:assert/strict";
import test from "node:test";

import { OrderService } from "../src/orders.service.js";

const key = "00000000-0000-4000-8000-000000000001";
const input = {
  lines: [
    {
      productId: "p-1",
      sku: "SKU-01",
      name: "Botella térmica",
      quantity: 2,
      unitPriceCop: 65000,
    },
  ],
};

test("forwards the authenticated customer and idempotency key to orders service", async () => {
  const calls: Array<{
    url: string;
    payload: unknown;
    idempotencyKey: string | null;
  }> = [];
  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      });

      return new Response(
        JSON.stringify({
          data: {
            orderId: "order-123",
            subtotalCop: 130000,
            deliveryFeeCop: 12000,
            totalCop: 142000,
            event: {
              eventType: "OrderCreated.v1",
              eventId: "order-123-created",
              occurredAt: "2026-10-29T00:00:00.000Z",
              aggregateId: "order-123",
              payload: {
                customerId: "customer-42",
                subtotalCop: 130000,
                deliveryFeeCop: 12000,
                totalCop: 142000,
                currency: "COP",
                lines: input.lines,
              },
            },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
    "http://orders-service.local",
  );

  const result = await service.createOrder(input, "customer-42", key);

  assert.equal(result.orderId, "order-123");
  assert.equal(result.totalCop, 142000);
  assert.equal(result.event.payload.customerId, "customer-42");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://orders-service.local/orders");
  assert.equal(calls[0]?.idempotencyKey, key);
  assert.deepEqual(calls[0]?.payload, {
    customerId: "customer-42",
    lines: input.lines,
  });
});

test("rejects malformed order data before calling orders service", async () => {
  const service = new OrderService(
    async () => {
      throw new Error("The orders service must not be called");
    },
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder({ lines: [{ quantity: 0 }] }, "customer-42", key),
    { name: "BadRequestException" },
  );
});

test("requires a UUID idempotency key", async () => {
  const service = new OrderService(
    async () => new Response(null, { status: 201 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", undefined),
    { name: "BadRequestException" },
  );
});

test("maps an orders-service validation failure to HTTP 400", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "invalid" }), { status: 400 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", key),
    { name: "BadRequestException" },
  );
});

test("maps an idempotency conflict from orders-service to HTTP 409", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "conflict" }), { status: 409 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", key),
    { name: "ConflictException" },
  );
});

test("maps a network failure from orders-service to HTTP 503", async () => {
  const service = new OrderService(
    async () => {
      throw new TypeError("fetch failed");
    },
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", key),
    { name: "ServiceUnavailableException" },
  );
});
