import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { OrderDomain } from "../src/orders.domain.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import {
  InventoryCommandWorker,
  InventoryReservationRejectedError,
} from "../src/inventory-command.worker.js";
import {
  HttpOrderEventPublisher,
  OrdersService,
  type OrderEventPublisher,
} from "../src/orders.service.js";
import type { OrderCreatedEvent } from "../src/orders.types.js";

const catalogProduct: CatalogProduct = {
  id: "p-1",
  sku: "SKU-01",
  name: "Botella térmica",
  description: "Producto de prueba",
  priceCop: 65000,
  stock: 5,
};

const idempotencyKey = "00000000-0000-4000-8000-000000000001";
const orderEvent: OrderCreatedEvent = {
  eventType: "OrderCreated.v1",
  eventId: "order-1-created",
  occurredAt: "2026-10-30T00:00:00.000Z",
  aggregateId: "order-1",
  payload: {
    customerId: "customer-1",
    subtotalCop: 25000,
    deliveryFeeCop: 12000,
    totalCop: 37000,
    currency: "COP",
    lines: [{
      productId: "p-1",
      sku: "SKU-01",
      name: "Botella térmica",
      quantity: 1,
      unitPriceCop: 25000,
    }],
  },
};

function createService(
  repository = new InMemoryOrdersRepository(),
  publisher: OrderEventPublisher = { publishCreated: async () => undefined },
  products: CatalogProduct[] = [catalogProduct],
  inventoryCommandProcessor?: { processPendingCommands(): Promise<void> },
): OrdersService {
  return new OrdersService(
    repository,
    { listActiveProducts: async () => products },
    publisher,
    inventoryCommandProcessor,
  );
}

function createLine(overrides: { quantity?: number; unitPriceCop?: number } = {}) {
  return {
    productId: catalogProduct.id,
    sku: catalogProduct.sku,
    name: catalogProduct.name,
    quantity: overrides.quantity ?? 1,
    unitPriceCop: overrides.unitPriceCop ?? catalogProduct.priceCop,
  };
}

test("creates a valid order and stores its financial totals", async () => {
  const service = createService();
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine({ quantity: 2 })],
  }, idempotencyKey);

  assert.equal(order.subtotalCop, 130000);
  assert.equal(order.deliveryFeeCop, 12000);
  assert.equal(order.totalCop, 142000);
  assert.equal(order.status, "RESERVING_INVENTORY");
  assert.ok(order.reservationExpiresAt);
  assert.equal(
    Date.parse(order.reservationExpiresAt) - Date.parse(order.createdAt),
    6 * 60 * 60 * 1_000,
  );
  assert.equal(order.lines.length, 1);

  const persisted = await service.getOrderById(order.orderId, "customer-1");
  assert.equal(persisted?.customerId, "customer-1");
  assert.equal(persisted?.orderId, order.orderId);
  assert.equal(persisted?.subtotalCop, 130000);
  assert.equal(persisted?.paymentDecision, null);
});

test("expires only overdue unsubmitted reservations and enqueues RELEASE once", async () => {
  const repository = new InMemoryOrdersRepository();
  const now = new Date("2026-10-30T18:00:00.000Z");
  const createRecord = (
    key: string,
    status: "AWAITING_PAYMENT_PROOF" | "PAYMENT_REVIEW_PENDING",
    reservationExpiresAt: Date,
  ) => {
    const record = OrderDomain.createOrder({
      customerId: "customer-1",
      idempotencyKey: key,
      lines: [createLine()],
    });
    record.status = status;
    record.reservationExpiresAt = reservationExpiresAt;
    return record;
  };
  const persist = async (
    record: ReturnType<typeof createRecord>,
  ) => repository.save(
    record,
    {
      ...orderEvent,
      eventId: `${record.orderId}-created`,
      aggregateId: record.orderId,
    },
    {
      commandId: `${record.orderId}-reserve-inventory`,
      idempotencyKey: `${record.orderId}:RESERVE`,
      orderId: record.orderId,
      commandType: "RESERVE",
      payload: {},
    },
  );
  const overdue = createRecord(
    "overdue-order",
    "AWAITING_PAYMENT_PROOF",
    new Date(now.getTime() - 1),
  );
  const notDue = createRecord(
    "not-due-order",
    "AWAITING_PAYMENT_PROOF",
    new Date(now.getTime() + 1),
  );
  const alreadySubmitted = createRecord(
    "submitted-order",
    "PAYMENT_REVIEW_PENDING",
    new Date(now.getTime() - 1),
  );
  await persist(overdue);
  await persist(notDue);
  await persist(alreadySubmitted);

  assert.equal(await repository.expireDueOrders(now, 25), 1);
  assert.equal((await repository.findByOrderId(overdue.orderId))?.status, "RESERVATION_EXPIRED");
  assert.equal((await repository.findByOrderId(notDue.orderId))?.status, "AWAITING_PAYMENT_PROOF");
  assert.equal(
    (await repository.findByOrderId(alreadySubmitted.orderId))?.status,
    "PAYMENT_REVIEW_PENDING",
  );
  assert.equal(await repository.expireDueOrders(now, 25), 0);

  const commands = await repository.claimPendingCommands(now, 30_000, 25);
  assert.equal(commands.filter(({ command }) => command.commandType === "RELEASE").length, 1);
  assert.equal(
    commands.find(({ command }) => command.commandType === "RELEASE")?.command.orderId,
    overdue.orderId,
  );
});

test("cancels an active reservation once and immediately processes its RELEASE", async () => {
  const repository = new InMemoryOrdersRepository();
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey: "cancel-order",
    lines: [createLine()],
  });
  record.status = "AWAITING_PAYMENT_PROOF";
  record.reservationExpiresAt = new Date(Date.now() + 60_000);
  await repository.save(
    record,
    {
      ...orderEvent,
      eventId: `${record.orderId}-created`,
      aggregateId: record.orderId,
    },
    {
      commandId: `${record.orderId}-reserve-inventory`,
      idempotencyKey: `${record.orderId}:RESERVE`,
      orderId: record.orderId,
      commandType: "RESERVE",
      payload: {},
    },
  );
  let processCalls = 0;
  const service = createService(
    repository,
    undefined,
    [catalogProduct],
    { processPendingCommands: async () => { processCalls += 1; } },
  );

  const first = await service.cancelOrder(record.orderId, "customer-1");
  const replay = await service.cancelOrder(record.orderId, "customer-1");

  assert.equal(first.result, "cancelled");
  assert.equal(first.order?.status, "CANCELLED");
  assert.equal(replay.result, "already-cancelled");
  assert.equal(replay.order?.status, "CANCELLED");
  assert.equal(processCalls, 1);
  const commands = await repository.claimPendingCommands(new Date(), 30_000, 25);
  assert.equal(commands.filter(({ command }) => command.commandType === "RELEASE").length, 1);
});

test("returns an order only to its owner", async () => {
  const service = createService();
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);

  assert.equal(
    (await service.getOrderById(order.orderId, "customer-1"))?.orderId,
    order.orderId,
  );
  assert.equal(await service.getOrderById(order.orderId, "customer-2"), null);
});

test("includes persisted payment decision details in the customer order view", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey,
    lines: [createLine()],
  });
  record.paymentDecision = {
    decision: "REJECTED",
    decidedAt: new Date("2026-10-30T12:00:00.000Z"),
    reason: "El comprobante no corresponde al total del pedido.",
  };

  const view = OrderDomain.toOrderView(record);

  assert.deepEqual(view.paymentDecision, {
    decision: "REJECTED",
    decidedAt: "2026-10-30T12:00:00.000Z",
    reason: "El comprobante no corresponde al total del pedido.",
  });
});

test("rejects an order without valid lines", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({ customerId: "customer-1", lines: [] }, idempotencyKey),
    { name: "InvalidOrderError" },
  );
});

test("rejects a line with a manipulated price", async () => {
  const service = createService();

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      lines: [createLine({ unitPriceCop: 1 })],
    }, idempotencyKey),
    /Product price is not current/,
  );
});

test("uses the catalog name as the persisted line snapshot", async () => {
  const order = await createService().createOrder({
    customerId: "customer-1",
    lines: [{ ...createLine(), name: "Nombre enviado por el cliente" }],
  }, idempotencyKey);

  assert.equal(order.lines[0]?.name, catalogProduct.name);
});

test("rejects a line above the active catalog stock", async () => {
  await assert.rejects(
    () => createService().createOrder({
      customerId: "customer-1",
      lines: [createLine({ quantity: 6 })],
    }, idempotencyKey),
    /Insufficient stock/,
  );
});

test("rejects a product that is not in the active catalog", async () => {
  await assert.rejects(
    () => createService(new InMemoryOrdersRepository(), undefined, []).createOrder({
      customerId: "customer-1",
      lines: [createLine()],
    }, idempotencyKey),
    /Product line is not current/,
  );
});

test("replays the saved order for the same key and payload without republishing", async () => {
  const repository = new InMemoryOrdersRepository();
  let published = 0;
  const service = createService(repository, {
    publishCreated: async () => {
      published += 1;
    },
  });
  const request = { customerId: "customer-1", lines: [createLine()] };

  const first = await service.createOrder(request, idempotencyKey);
  const replay = await service.createOrder(request, idempotencyKey);

  assert.equal(replay.orderId, first.orderId);
  assert.equal(published, 1);
  const command = await repository.claimPendingCommands(new Date(), 30_000, 10);
  assert.equal(command.length, 1);
  assert.equal(command[0]?.command.commandType, "RESERVE");
  assert.equal(command[0]?.command.idempotencyKey, `${first.orderId}:RESERVE`);
  assert.deepEqual(command[0]?.command.payload, {
    lines: [{ productId: catalogProduct.id, quantity: 1 }],
    expiresAt: first.reservationExpiresAt,
  });
});

test("moves an order to awaiting proof after catalog confirms reservation", async () => {
  const repository = new InMemoryOrdersRepository();
  const service = createService(repository);
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);
  const worker = new InventoryCommandWorker(repository, { dispatch: async () => undefined });

  await worker.processPendingCommands();

  const updated = await service.getOrderById(order.orderId, "customer-1");
  assert.equal(updated?.status, "AWAITING_PAYMENT_PROOF");
});

test("approves a pending payment once and enqueues one idempotent inventory commit", async () => {
  const repository = new InMemoryOrdersRepository();
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey,
    lines: [createLine()],
  });
  record.status = "PAYMENT_REVIEW_PENDING";
  await repository.save(record, {
    ...orderEvent,
    aggregateId: record.orderId,
    eventId: `${record.orderId}-created`,
  }, {
    commandId: `${record.orderId}-reserve-inventory`,
    idempotencyKey: `${record.orderId}:RESERVE`,
    orderId: record.orderId,
    commandType: "RESERVE",
    payload: {},
  });
  const service = createService(repository);

  const [first, replay] = await Promise.all([
    service.approvePayment(record.orderId, "store-admin-1"),
    service.approvePayment(record.orderId, "store-admin-1"),
  ]);
  const commitCommands = await repository.claimPendingCommands(new Date(), 30_000, 10);
  const commit = commitCommands.find(({ command }) => command.commandType === "COMMIT");

  assert.equal(first.order?.status, "PAYMENT_APPROVED_FINALIZING");
  assert.equal(first.order?.paymentDecision?.decision, "APPROVED");
  assert.ok(first.order?.paymentDecision?.decidedAt);
  assert.ok(["approved", "already-approved"].includes(first.result));
  assert.ok(["approved", "already-approved"].includes(replay.result));
  assert.equal(first.result === replay.result, false);
  assert.equal(commitCommands.filter(({ command }) => command.commandType === "COMMIT").length, 1);
  assert.equal(commit?.command.commandId, `${record.orderId}-commit-inventory`);
  assert.equal(commit?.command.idempotencyKey, `${record.orderId}:COMMIT`);
});

test("moves an approved order to confirmed only after catalog commit completes", async () => {
  const repository = new InMemoryOrdersRepository();
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey,
    lines: [createLine()],
  });
  record.status = "PAYMENT_APPROVED_FINALIZING";
  record.paymentDecision = {
    decision: "APPROVED",
    decidedAt: new Date(),
    reason: null,
  };
  await repository.save(record, {
    ...orderEvent,
    aggregateId: record.orderId,
    eventId: `${record.orderId}-created`,
  }, {
    commandId: `${record.orderId}-commit-inventory`,
    idempotencyKey: `${record.orderId}:COMMIT`,
    orderId: record.orderId,
    commandType: "COMMIT",
    payload: {},
  });
  const worker = new InventoryCommandWorker(repository, { dispatch: async () => undefined });

  await worker.processPendingCommands();

  assert.equal((await repository.findByOrderId(record.orderId))?.status, "CONFIRMED");
});

test("rejects a pending payment once, queues release, and immediately triggers inventory processing", async () => {
  const repository = new InMemoryOrdersRepository();
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey,
    lines: [createLine()],
  });
  record.status = "PAYMENT_REVIEW_PENDING";
  await repository.save(record, {
    ...orderEvent,
    aggregateId: record.orderId,
    eventId: `${record.orderId}-created`,
  }, {
    commandId: `${record.orderId}-reserve-inventory`,
    idempotencyKey: `${record.orderId}:RESERVE`,
    orderId: record.orderId,
    commandType: "RESERVE",
    payload: {},
  });
  let processCalls = 0;
  const service = createService(repository, undefined, undefined, {
    processPendingCommands: async () => {
      processCalls += 1;
    },
  });
  const reason = "  El comprobante no corresponde al total del pedido.  ";

  const [first, replay] = await Promise.all([
    service.rejectPayment(record.orderId, "store-admin-1", reason),
    service.rejectPayment(record.orderId, "store-admin-2", reason),
  ]);
  const commands = await repository.claimPendingCommands(new Date(), 30_000, 10);
  const release = commands.find(({ command }) => command.commandType === "RELEASE");

  assert.equal(first.order?.status, "CANCELLED");
  assert.equal(first.order?.paymentDecision?.decision, "REJECTED");
  assert.equal(first.order?.paymentDecision?.reason, reason.trim());
  assert.ok(first.order?.paymentDecision?.decidedAt);
  assert.ok(["rejected", "already-rejected"].includes(first.result));
  assert.ok(["rejected", "already-rejected"].includes(replay.result));
  assert.notEqual(first.result, replay.result);
  assert.equal(processCalls, 1);
  assert.equal(commands.filter(({ command }) => command.commandType === "RELEASE").length, 1);
  assert.equal(release?.command.commandId, `${record.orderId}-release-inventory`);
  assert.equal(release?.command.idempotencyKey, `${record.orderId}:RELEASE`);
});

test("rejects blank and oversized payment decision reasons", async () => {
  const service = createService();
  await assert.rejects(
    () => service.rejectPayment("order-123", "admin-1", " \t "),
    { name: "InvalidPaymentDecisionError" },
  );
  await assert.rejects(
    () => service.rejectPayment("order-123", "admin-1", "x".repeat(1001)),
    { name: "InvalidPaymentDecisionError" },
  );
});

test("marks an order failed when catalog permanently rejects its reservation", async () => {
  const repository = new InMemoryOrdersRepository();
  const service = createService(repository);
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);
  const worker = new InventoryCommandWorker(repository, {
    dispatch: async () => {
      throw new InventoryReservationRejectedError("Insufficient inventory");
    },
  });

  await worker.processPendingCommands();

  const updated = await service.getOrderById(order.orderId, "customer-1");
  assert.equal(updated?.status, "RESERVATION_FAILED");
});

test("rejects reuse of an idempotency key with a different payload", async () => {
  const service = createService();
  await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);

  await assert.rejects(
    () => service.createOrder({
      customerId: "customer-1",
      lines: [createLine({ quantity: 2 })],
    }, idempotencyKey),
    { name: "OrderConflictError" },
  );
});

test("returns the persisted order when event publication fails and schedules retry", async () => {
  const repository = new InMemoryOrdersRepository();
  const service = createService(repository, {
    publishCreated: async () => {
      throw new Error("worker unavailable");
    },
  });

  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);
  const retry = await repository.claimPendingEvents(
    new Date(Date.now() + 6_000),
    30_000,
    25,
  );

  assert.equal(order.orderId.startsWith("order-"), true);
  assert.equal(retry.length, 1);
  assert.equal(retry[0]?.event.aggregateId, order.orderId);
});

test("only one concurrent worker can claim an event and an expired claim is recoverable", async () => {
  const repository = new InMemoryOrdersRepository();
  const service = createService(repository, {
    publishCreated: async () => {
      throw new Error("worker unavailable");
    },
  });
  const order = await service.createOrder({
    customerId: "customer-1",
    lines: [createLine()],
  }, idempotencyKey);

  const now = new Date(Date.now() + 10_000);
  const [first, second] = await Promise.all([
    repository.claimPendingEvents(now, 1_000, 10),
    repository.claimPendingEvents(now, 1_000, 10),
  ]);
  const initialClaim = [...first, ...second][0];
  assert.ok(initialClaim);
  assert.equal(first.length + second.length, 1);

  const recovered = await repository.claimPendingEvents(
    new Date(now.getTime() + 1_001),
    1_000,
    10,
  );
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.event.aggregateId, order.orderId);
  await assert.rejects(
    () => repository.markEventPublished(
      initialClaim.event.eventId,
      initialClaim.claimToken,
      new Date(),
    ),
    /claim lost/,
  );
});

test("builds the domain object with free delivery at the configured threshold", () => {
  const record = OrderDomain.createOrder({
    customerId: "customer-2",
    idempotencyKey,
    lines: [
      {
        productId: "p-2",
        sku: "SKU-02",
        name: "Pañal premium",
        quantity: 3,
        unitPriceCop: 50000,
      },
    ],
  });

  assert.equal(record.subtotalCop, 150000);
  assert.equal(record.deliveryFeeCop, 0);
  assert.equal(record.totalCop, 150000);
  assert.equal(record.orderId.startsWith("order-"), true);
});

test("getOrderById returns null for a non-existent order", async () => {
  const result = await createService().getOrderById("order-does-not-exist", "customer-1");
  assert.equal(result, null);
});

test("treats a worker PROCESSING response as retryable, not delivered", async () => {
  const publisher = new HttpOrderEventPublisher(
    async () => new Response(JSON.stringify({ status: "processing" }), { status: 202 }),
    "http://notification-worker.local",
  );

  await assert.rejects(() => publisher.publishCreated(orderEvent), /did not finish event delivery/);
});
