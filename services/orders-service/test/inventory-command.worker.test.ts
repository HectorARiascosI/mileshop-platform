import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryInventoryCommandRepository,
  type InventoryCommand,
} from "../src/inventory-command.repository.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import { OrderDomain } from "../src/orders.domain.js";
import {
  InventoryReservationExpiredError,
  HttpInventoryCommandDispatcher,
  InventoryCommandWorker,
} from "../src/inventory-command.worker.js";

const command: InventoryCommand = {
  commandId: "command-1",
  idempotencyKey: "command-1",
  orderId: "order-1",
  commandType: "RESERVE",
  payload: { lines: [{ productId: "product-1", quantity: 2 }] },
};

test("dispatches a claimed inventory command once and records completion", async () => {
  const repository = new InMemoryInventoryCommandRepository();
  repository.add(command);
  let dispatchCount = 0;
  const worker = new InventoryCommandWorker(repository, {
    dispatch: async (receivedCommand) => {
      dispatchCount += 1;
      assert.deepEqual(receivedCommand, command);
    },
  });

  await worker.processPendingCommands();
  await worker.processPendingCommands();

  assert.equal(dispatchCount, 1);
});

test("schedules a failed dispatch for retry without marking it complete", async () => {
  const repository = new InMemoryInventoryCommandRepository();
  repository.add(command);
  let dispatchCount = 0;
  const dispatcher = {
    dispatch: async () => {
      dispatchCount += 1;
      if (dispatchCount === 1) {
        throw new Error("catalog unavailable");
      }
    },
  };
  const worker = new InventoryCommandWorker(repository, dispatcher);

  await worker.processPendingCommands();
  const retry = await repository.claimPendingCommands(
    new Date(Date.now() + 6_000),
    30_000,
    10,
  );
  const retryClaim = retry[0];
  assert.ok(retryClaim);
  await dispatcher.dispatch(retryClaim.command);
  assert.equal(dispatchCount, 2);
  await repository.markCommandCompleted(
    retryClaim.command.commandId,
    retryClaim.claimToken,
    new Date(),
  );
  assert.equal(dispatchCount, 2);
});

test("allows only one concurrent claim and recovers an expired lease", async () => {
  const repository = new InMemoryInventoryCommandRepository();
  repository.add(command);
  const now = new Date();
  const [first, second] = await Promise.all([
    repository.claimPendingCommands(now, 1_000, 10),
    repository.claimPendingCommands(now, 1_000, 10),
  ]);
  const initialClaim = [...first, ...second][0];
  assert.ok(initialClaim);
  assert.equal(first.length + second.length, 1);

  const recovered = await repository.claimPendingCommands(
    new Date(now.getTime() + 1_001),
    1_000,
    10,
  );
  assert.equal(recovered.length, 1);
  await assert.rejects(
    () => repository.markCommandCompleted(
      initialClaim.command.commandId,
      initialClaim.claimToken,
      new Date(),
    ),
    /claim lost/,
  );
});

test("sends the stable idempotency key and command envelope to the catalog route", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const dispatcher = new HttpInventoryCommandDispatcher(
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ data: { status: "ACTIVE" } }, { status: 200 });
    },
    "http://catalog.local",
    "local-command-secret",
  );
  const commandWithConflictingPayload = {
    ...command,
    payload: { ...command.payload, commandId: "spoofed-command", orderId: "spoofed-order" },
  };

  await dispatcher.dispatch(commandWithConflictingPayload);

  assert.equal(requestUrl, "http://catalog.local/internal/inventory/reservations");
  assert.equal(new Headers(requestInit?.headers).get("idempotency-key"), command.orderId);
  assert.equal(
    new Headers(requestInit?.headers).get("authorization"),
    "Bearer local-command-secret",
  );
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    commandId: command.commandId,
    orderId: command.orderId,
    ...command.payload,
  });
});

test("dispatches approval commits to the catalog commit endpoint idempotently", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const dispatcher = new HttpInventoryCommandDispatcher(
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ data: { status: "COMMITTED" } }, { status: 200 });
    },
    "http://catalog.local",
    "local-command-secret",
  );
  const commitCommand: InventoryCommand = {
    commandId: "order-1-commit-inventory",
    idempotencyKey: "order-1:COMMIT",
    orderId: "order-1",
    commandType: "COMMIT",
    payload: {},
  };

  await dispatcher.dispatch(commitCommand);

  assert.equal(requestUrl, "http://catalog.local/internal/inventory/reservations/commit");
  assert.equal(new Headers(requestInit?.headers).get("idempotency-key"), "order-1");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    commandId: "order-1-commit-inventory",
    orderId: "order-1",
  });
});

test("keeps a non-success catalog response retryable", async () => {
  const dispatcher = new HttpInventoryCommandDispatcher(
    async () => new Response(null, { status: 503 }),
    "http://catalog.local",
    "local-command-secret",
  );

  await assert.rejects(
    () => dispatcher.dispatch(command),
    /HTTP 503/,
  );
});

test("treats a catalog reservation conflict as a terminal business rejection", async () => {
  const dispatcher = new HttpInventoryCommandDispatcher(
    async () => new Response(null, { status: 409 }),
    "http://catalog.local",
    "local-command-secret",
  );

  await assert.rejects(
    () => dispatcher.dispatch(command),
    /Catalog rejected the reservation with HTTP 409/,
  );
});

test("marks a reservation expired without dispatching a command past its deadline", async () => {
  const repository = new InMemoryOrdersRepository();
  const record = OrderDomain.createOrder({
    customerId: "customer-1",
    idempotencyKey: "request-1",
    lines: [{
      productId: "product-1",
      sku: "SKU-01",
      name: "Product",
      quantity: 1,
      unitPriceCop: 100,
    }],
  });
  record.reservationExpiresAt = new Date(Date.now() - 1_000);
  const expiredCommand: InventoryCommand = {
    ...command,
    commandId: `${record.orderId}-reserve-inventory`,
    idempotencyKey: `${record.orderId}:RESERVE`,
    orderId: record.orderId,
    payload: {
      ...command.payload,
      expiresAt: record.reservationExpiresAt.toISOString(),
    },
  };
  await repository.save(record, {
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
      lines: record.lines.map(({ productId, sku, name, quantity, unitPriceCop }) => ({
        productId,
        sku,
        name,
        quantity,
        unitPriceCop,
      })),
    },
  }, expiredCommand);

  let dispatchCount = 0;
  const worker = new InventoryCommandWorker(repository, {
    dispatch: async () => {
      dispatchCount += 1;
    },
  });

  await worker.processPendingCommands();

  const expiredOrder = await repository.findByOrderId(record.orderId);
  assert.equal(dispatchCount, 0);
  assert.equal(expiredOrder?.status, "RESERVATION_EXPIRED");
});

test("treats a late catalog expiry response as a terminal expired reservation", async () => {
  const dispatcher = new HttpInventoryCommandDispatcher(
    async () => new Response(null, { status: 400 }),
    "http://catalog.local",
    "local-command-secret",
  );
  const expiredCommand: InventoryCommand = {
    ...command,
    payload: {
      ...command.payload,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    },
  };

  await assert.rejects(
    () => dispatcher.dispatch(expiredCommand),
    (error: unknown) => error instanceof InventoryReservationExpiredError,
  );
});

test("refuses to dispatch without the configured catalog command token", async () => {
  const dispatcher = new HttpInventoryCommandDispatcher(
    async () => {
      throw new Error("fetch must not run without the token");
    },
    "http://catalog.local",
    "",
  );

  await assert.rejects(
    () => dispatcher.dispatch(command),
    /CATALOG_INVENTORY_COMMAND_TOKEN is not configured/,
  );
});
