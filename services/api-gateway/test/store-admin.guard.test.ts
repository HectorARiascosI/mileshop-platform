import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";

import { StoreAdminGuard } from "../src/store-admin.guard.js";

function makeContext(request: unknown): {
  switchToHttp: () => { getRequest: () => unknown };
} {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

test("allows a verified store admin", () => {
  const guard = new StoreAdminGuard();
  const context = makeContext({
    raw: { customerId: "admin-1", role: "STORE_ADMIN" },
  });

  assert.equal(guard.canActivate(context as never), true);
});

test("rejects a customer from admin operations", () => {
  const guard = new StoreAdminGuard();
  const context = makeContext({
    raw: { customerId: "customer-1", role: "CUSTOMER" },
  });

  assert.throws(
    () => guard.canActivate(context as never),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("rejects requests without verified identity context", () => {
  const guard = new StoreAdminGuard();
  const context = makeContext({ raw: {} });

  assert.throws(
    () => guard.canActivate(context as never),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});

test("does not trust role fields outside the identity-verified raw request", () => {
  const guard = new StoreAdminGuard();
  const context = makeContext({
    role: "STORE_ADMIN",
    customerId: "forged-admin",
    raw: { role: "CUSTOMER", customerId: "customer-1" },
  });

  assert.throws(
    () => guard.canActivate(context as never),
    (error: unknown) => error instanceof ForbiddenException,
  );
});
