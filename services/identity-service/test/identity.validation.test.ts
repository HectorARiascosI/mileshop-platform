import assert from "node:assert/strict";
import { test } from "node:test";

import { registerSchema } from "../src/identity.validation.js";

test("public registration does not accept a caller-selected store role", () => {
  const parsed = registerSchema.parse({
    email: "customer@example.com",
    password: "password123",
    name: "Customer",
    role: "STORE_ADMIN",
  });

  assert.equal("role" in parsed, false);
});
