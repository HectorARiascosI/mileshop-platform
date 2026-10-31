import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { OrderDomain } from "../src/orders.domain.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import { OrdersService } from "../src/orders.service.js";

const product: CatalogProduct = {
  id: "product-1",
  sku: "SKU-1",
  name: "Product",
  description: "Test product",
  priceCop: 10_000,
  stock: 5,
};

async function createPendingReview() {
  const repository = new InMemoryOrdersRepository();
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey: "request-key",
    lines: [{
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unitPriceCop: product.priceCop,
    }],
  });
  record.status = "PAYMENT_REVIEW_PENDING";
  await repository.save(
    record,
    {
      eventType: "OrderCreated.v1",
      eventId: `${record.orderId}-created`,
      occurredAt: record.createdAt.toISOString(),
      aggregateId: record.orderId,
      payload: {
        customerId: record.customerId,
        subtotalCop: record.subtotalCop,
        deliveryFeeCop: record.deliveryFeeCop,
        totalCop: record.totalCop,
        currency: "COP",
        lines: [{
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: 1,
          unitPriceCop: product.priceCop,
        }],
      },
    },
    {
      commandId: `${record.orderId}-reserve-inventory`,
      idempotencyKey: `${record.orderId}:RESERVE`,
      orderId: record.orderId,
      commandType: "RESERVE",
      payload: {},
    },
  );
  return { repository, record };
}

test("post-proof requests are idempotent and only cancel after refund handling is recorded", async () => {
  const { repository, record } = await createPendingReview();
  let releaseAttempts = 0;
  const service = new OrdersService(
    repository,
    { listActiveProducts: async () => [product] },
    { publishCreated: async () => undefined },
    { processPendingCommands: async () => { releaseAttempts += 1; } },
  );

  const request = await service.requestCancellation(record.orderId, "customer-1");
  assert.equal(request.result, "requested");
  assert.equal(request.order?.status, "PAYMENT_REVIEW_PENDING");
  assert.equal(request.order?.cancellationRequest?.resolution, null);
  const replay = await service.requestCancellation(record.orderId, "customer-1");
  assert.equal(replay.result, "already-pending");
  assert.equal((await service.listPendingCancellationRequests()).length, 1);
  assert.equal((await service.approvePayment(record.orderId, "admin-1")).result, "not-pending");

  const blocked = await service.resolveCancellationRequest(
    record.orderId,
    "admin-1",
    "CANCEL",
    "Cancel requested.",
  );
  assert.equal(blocked.result, "refund-not-recorded");
  assert.equal(releaseAttempts, 0);

  assert.equal(
    (await service.recordCancellationRefund(
      record.orderId,
      "admin-1",
      true,
      "refund-123",
    )).result,
    "recorded",
  );
  const cancelled = await service.resolveCancellationRequest(
    record.orderId,
    "admin-1",
    "CANCEL",
    "External refund reference refund-123.",
  );
  assert.equal(cancelled.result, "cancelled");
  assert.equal(cancelled.order?.status, "CANCELLED");
  assert.equal(cancelled.order?.cancellationRequest?.resolution, "CANCELLED");
  assert.equal((await service.listPendingCancellationRequests()).length, 0);
  assert.equal(releaseAttempts, 1);
});

test("admin may keep a requested order open without releasing its reservation", async () => {
  const { repository, record } = await createPendingReview();
  const service = new OrdersService(
    repository,
    { listActiveProducts: async () => [product] },
    { publishCreated: async () => undefined },
  );
  let releaseCommands = 0;
  const originalAdd = repository.add.bind(repository);
  repository.add = (command) => {
    if (command.commandType === "RELEASE") {
      releaseCommands += 1;
    }
    originalAdd(command);
  };

  await service.requestCancellation(record.orderId, "customer-1");
  const keptOpen = await service.resolveCancellationRequest(
    record.orderId,
    "admin-1",
    "KEEP_OPEN",
    "The customer agreed to continue with the order.",
  );
  assert.equal(keptOpen.result, "kept-open");
  assert.equal(keptOpen.order?.status, "PAYMENT_REVIEW_PENDING");
  assert.equal(keptOpen.order?.cancellationRequest?.resolution, "KEPT_OPEN");
  assert.equal(releaseCommands, 0);
  assert.equal((await service.approvePayment(record.orderId, "admin-1")).result, "approved");
});
