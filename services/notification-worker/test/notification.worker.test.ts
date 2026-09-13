import test from "node:test";
import assert from "node:assert/strict";

import type { OrderCreatedEvent } from "../src/events.js";
import {
  InMemoryNotificationStore,
  NotificationWorker,
  type NotificationSender,
} from "../src/notification.worker.js";

const event: OrderCreatedEvent = {
  eventType: "OrderCreated.v1",
  eventId: "evt-1",
  occurredAt: "2026-09-13T12:00:00.000Z",
  aggregateId: "order-1",
  payload: {
    customerId: "customer-1",
    totalCop: 25000,
    currency: "COP",
    lines: [
      {
        productId: "product-1",
        sku: "SKU-1",
        name: "Producto de prueba",
        quantity: 1,
        unitPriceCop: 25000,
      },
    ],
  },
};

test("sends an event once and deduplicates retries", async () => {
  const sentEventIds: string[] = [];
  const store = new InMemoryNotificationStore();
  const sender: NotificationSender = {
    async sendOrderCreated(receivedEvent) {
      sentEventIds.push(receivedEvent.eventId);
    },
  };
  const worker = new NotificationWorker(store, sender);

  assert.equal(await worker.handleOrderCreated(event), "sent");
  assert.equal(await worker.handleOrderCreated(event), "duplicate");
  assert.deepEqual(sentEventIds, ["evt-1"]);
});
