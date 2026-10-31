import assert from "node:assert/strict";
import test from "node:test";

import { paymentEvidenceRetentionDeadline } from "../src/payment-evidence/payment-evidence-retention.js";

test("sets retention exactly 12 calendar months after closure", () => {
  assert.equal(
    paymentEvidenceRetentionDeadline(new Date("2026-10-30T12:34:56.789Z")).toISOString(),
    "2027-10-30T12:34:56.789Z",
  );
  assert.equal(
    paymentEvidenceRetentionDeadline(new Date("2024-02-29T12:00:00.000Z")).toISOString(),
    "2025-02-28T12:00:00.000Z",
  );
});

test("rejects an invalid order closure date", () => {
  assert.throws(
    () => paymentEvidenceRetentionDeadline(new Date(Number.NaN)),
    /valid date/,
  );
});
