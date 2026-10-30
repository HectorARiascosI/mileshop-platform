import test from "node:test";
import assert from "node:assert/strict";

import { orderCreatedSchema, type OrderCreatedEvent } from "../src/events.js";
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
    subtotalCop: 25000,
    deliveryFeeCop: 12000,
    totalCop: 37000,
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

test("rejects event totals that do not match the order lines", () => {
  const parsed = orderCreatedSchema.safeParse({
    ...event,
    payload: { ...event.payload, totalCop: 25000 },
  });
  assert.equal(parsed.success, false);
});

test("sends an event once and deduplicates completed retries", async () => {
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

test("reports an active concurrent delivery as processing", async () => {
  const store = new InMemoryNotificationStore();
  let releaseDelivery: (() => void) | undefined;
  const pendingSender: NotificationSender = {
    sendOrderCreated: () => new Promise((resolve) => {
      releaseDelivery = resolve;
    }),
  };
  const worker = new NotificationWorker(store, pendingSender);

  const delivery = worker.handleOrderCreated(event);
  assert.equal(await worker.handleOrderCreated(event), "processing");
  releaseDelivery?.();
  assert.equal(await delivery, "sent");
});

test("recovers a delivery abandoned beyond its lease", async () => {
  const store = new InMemoryNotificationStore();
  const initialTime = new Date("2026-09-13T12:00:00.000Z");
  const initialClaim = await store.claim(event.eventId, initialTime, 1_000);
  assert.equal(initialClaim.status, "claimed");
  if (initialClaim.status !== "claimed") {
    return;
  }

  const recoveredClaim = await store.claim(
    event.eventId,
    new Date(initialTime.getTime() + 1_001),
    1_000,
  );
  assert.equal(recoveredClaim.status, "claimed");
  if (recoveredClaim.status !== "claimed") {
    return;
  }

  await assert.rejects(() => store.markSent(event.eventId, initialClaim.claimToken), /claim lost/);
  await store.markSent(event.eventId, recoveredClaim.claimToken);
});

test("retries a failed delivery", async () => {
  const store = new InMemoryNotificationStore();
  const failedClaim = await store.claim(event.eventId);
  assert.equal(failedClaim.status, "claimed");
  if (failedClaim.status !== "claimed") {
    return;
  }
  await store.markFailed(event.eventId, failedClaim.claimToken, "temporary error");

  const retryClaim = await store.claim(event.eventId);
  assert.equal(retryClaim.status, "claimed");
  if (retryClaim.status !== "claimed") {
    return;
  }
  await store.markSent(event.eventId, retryClaim.claimToken);
});
