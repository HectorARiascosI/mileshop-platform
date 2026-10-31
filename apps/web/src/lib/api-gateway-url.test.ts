import assert from "node:assert/strict";
import test from "node:test";

import { getApiGatewayEndpoint } from "./api-gateway-url";

test("rejects a missing gateway URL", () => {
  assert.equal(getApiGatewayEndpoint("/orders", { gatewayUrl: "" }), null);
});

test("allows a local HTTP gateway outside production", () => {
  assert.equal(
    getApiGatewayEndpoint("/catalog/products", {
      gatewayUrl: "http://localhost:3000",
      isProduction: false,
    })?.toString(),
    "http://localhost:3000/catalog/products",
  );
});

test("preserves a configured gateway base path", () => {
  assert.equal(
    getApiGatewayEndpoint("/orders", {
      gatewayUrl: "https://gateway.example.com/api/",
      isProduction: true,
    })?.toString(),
    "https://gateway.example.com/api/orders",
  );
});

test("requires HTTPS in production", () => {
  assert.equal(
    getApiGatewayEndpoint("/orders", {
      gatewayUrl: "http://gateway.example.com",
      isProduction: true,
    }),
    null,
  );
});

test("rejects unsafe or malformed gateway URLs and paths", () => {
  assert.equal(
    getApiGatewayEndpoint("/orders", {
      gatewayUrl: "https://user:password@gateway.example.com",
      isProduction: true,
    }),
    null,
  );
  assert.equal(
    getApiGatewayEndpoint("/orders", {
      gatewayUrl: "https://gateway.example.com?token=secret",
      isProduction: true,
    }),
    null,
  );
  assert.equal(
    getApiGatewayEndpoint("//attacker.example.com/path", {
      gatewayUrl: "https://gateway.example.com",
      isProduction: true,
    }),
    null,
  );
  assert.equal(
    getApiGatewayEndpoint("/orders/../admin", {
      gatewayUrl: "https://gateway.example.com",
      isProduction: true,
    }),
    null,
  );
});
