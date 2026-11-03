import assert from "node:assert/strict";
import test from "node:test";

import { exchangeRefreshToken } from "./auth-session";

const gatewayUrl = "http://identity.local";
const refreshToken = "refresh-token";

test("returns rotated tokens when refresh succeeds", async () => {
  const result = await exchangeRefreshToken(
    gatewayUrl,
    refreshToken,
    async () => Response.json({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    }),
  );

  assert.deepEqual(result, {
    status: "refreshed",
    tokens: {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    },
  });
});

test("treats a rejected refresh token as unauthenticated", async () => {
  const result = await exchangeRefreshToken(
    gatewayUrl,
    refreshToken,
    async () => new Response(null, { status: 401 }),
  );

  assert.deepEqual(result, { status: "unauthenticated" });
});

test("treats upstream errors as unavailable without expiring the session", async () => {
  const result = await exchangeRefreshToken(
    gatewayUrl,
    refreshToken,
    async () => new Response(null, { status: 503 }),
  );

  assert.deepEqual(result, { status: "unavailable" });
});

test("treats network errors as unavailable without expiring the session", async () => {
  const result = await exchangeRefreshToken(gatewayUrl, refreshToken, async () => {
    throw new TypeError("fetch failed");
  });

  assert.deepEqual(result, { status: "unavailable" });
});

test("rejects malformed refresh responses", async () => {
  const result = await exchangeRefreshToken(
    gatewayUrl,
    refreshToken,
    async () => Response.json({ accessToken: "new-access-token" }),
  );

  assert.deepEqual(result, { status: "unavailable" });
});
