import assert from "node:assert/strict";
import test from "node:test";

import {
  OrderExpiryWorker,
  RESERVATION_EXPIRY_POLL_INTERVAL_MS,
} from "../src/order-expiry.worker.js";

test("runs an initial expiry scan and bounds polling to 30 seconds", async () => {
  let calls = 0;
  let releaseAttempts = 0;
  const worker = new OrderExpiryWorker({
    expireDueOrders: async (_now, limit) => {
      calls += 1;
      assert.equal(limit, 25);
      return 1;
    },
  }, {
    processPendingCommands: async () => {
      releaseAttempts += 1;
    },
  });

  worker.onModuleInit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  worker.onModuleDestroy();

  assert.equal(calls, 1);
  assert.equal(releaseAttempts, 1);
  assert.ok(RESERVATION_EXPIRY_POLL_INTERVAL_MS <= 30_000);
});

test("claims due-order expiration work once when polling overlaps", async () => {
  let releaseScan: (() => void) | undefined;
  let calls = 0;
  const worker = new OrderExpiryWorker({
    expireDueOrders: async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        releaseScan = resolve;
      });
      return 0;
    },
  });

  const firstScan = worker.processDueOrders();
  const overlappingScan = await worker.processDueOrders();
  releaseScan?.();
  await firstScan;

  assert.equal(overlappingScan, 0);
  assert.equal(calls, 1);
});
