import assert from "node:assert/strict";
import test from "node:test";

import { isPaymentEvidenceStorageConfigured } from "../src/app.module.js";

test("payment evidence providers are omitted in production without a storage adapter", () => {
  assert.equal(
    isPaymentEvidenceStorageConfigured({ NODE_ENV: "production" }),
    false,
  );
  assert.equal(
    isPaymentEvidenceStorageConfigured({
      NODE_ENV: "production",
      PAYMENT_EVIDENCE_STORAGE: "local",
    }),
    true,
  );
  assert.equal(isPaymentEvidenceStorageConfigured({ NODE_ENV: "development" }), true);
});
