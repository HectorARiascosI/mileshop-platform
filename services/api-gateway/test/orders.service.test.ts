import assert from "node:assert/strict";
import test from "node:test";

import { OrderService } from "../src/orders.service.js";

test("forwards the order created result from the orders service", async () => {
  const calls: Array<{ url: string; payload: unknown; idempotencyKey: string | null }> = [];

  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      });

      if (url === "http://orders-service.local/orders") {
        return new Response(
          JSON.stringify({
            data: {
              orderId: "order-123",
              customerId: "customer-42",
              subtotalCop: 130000,
              deliveryFeeCop: 12000,
              totalCop: 142000,
              status: "PENDING",
              createdAt: "2026-10-29T00:00:00.000Z",
              updatedAt: "2026-10-29T00:00:00.000Z",
              lines: [
                {
                  productId: "p-1",
                  sku: "SKU-01",
                  name: "Botella térmica",
                  quantity: 2,
                  unitPriceCop: 65000,
                },
              ],
              event: {
                eventType: "OrderCreated.v1",
                eventId: "order-123-event-1",
                occurredAt: "2026-10-29T00:00:00.000Z",
                aggregateId: "order-123",
                payload: {
                  customerId: "customer-42",
                  subtotalCop: 130000,
                  deliveryFeeCop: 12000,
                  totalCop: 142000,
                  currency: "COP",
                  lines: [
                    {
                      productId: "p-1",
                      sku: "SKU-01",
                      name: "Botella térmica",
                      quantity: 2,
                      unitPriceCop: 65000,
                    },
                  ],
                },
              },
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
    "http://orders-service.local",
  );

  const result = await service.createOrder({
    lines: [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        quantity: 2,
        unitPriceCop: 65000,
      },
    ],
  }, "customer-42", "00000000-0000-4000-8000-000000000001");

  assert.equal(result.orderId.startsWith("order-"), true);
  assert.equal(result.subtotalCop, 130000);
  assert.equal(result.deliveryFeeCop, 12000);
  assert.equal(result.totalCop, 142000);
  assert.equal(result.event.eventType, "OrderCreated.v1");
  assert.equal(result.event.payload.customerId, "customer-42");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://orders-service.local/orders");
  assert.equal(calls[0]?.idempotencyKey, "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(calls[0]?.payload, {
    customerId: "customer-42",
    lines: [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        quantity: 2,
        unitPriceCop: 65000,
      },
    ],
  });
});

test("maps an orders-service validation failure to HTTP 400", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "invalid" }), { status: 400 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(
      { lines: [] },
      "customer-42",
      "00000000-0000-4000-8000-000000000002",
    ),
    { name: "BadRequestException" },
  );
});

test("maps an idempotency conflict from orders-service to HTTP 409", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "conflict" }), { status: 409 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(
      { lines: [] },
      "customer-42",
      "00000000-0000-4000-8000-000000000003",
    ),
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
    () => service.createOrder(
      { lines: [] },
      "customer-42",
      "00000000-0000-4000-8000-000000000004",
    ),
    { name: "ServiceUnavailableException" },
  );
});
