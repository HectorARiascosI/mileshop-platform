import assert from "node:assert/strict";
import test from "node:test";

import { OrderService } from "../src/orders.service.js";

test("creates an order and publishes the OrderCreated event", async () => {
  const calls: Array<{ url: string; payload: unknown }> = [];

  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      return new Response(JSON.stringify({ status: "sent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    "http://notification-worker.local",
  );

  const result = await service.createOrder({
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

  assert.equal(result.orderId.startsWith("order-"), true);
  assert.equal(result.totalCop, 130000);
  assert.equal(result.event.eventType, "OrderCreated.v1");
  assert.equal(result.event.payload.customerId, "customer-42");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://notification-worker.local/events/order-created");
  assert.equal(calls[0]?.payload.payload.totalCop, 130000);
});
