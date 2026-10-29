import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import { IdentityClient } from "../src/identity.client.js";

const BASE_URL = "http://localhost:3040";

function makeClient(fetcher: typeof fetch): IdentityClient {
  return new IdentityClient(fetcher as typeof fetch, BASE_URL);
}

test("register proxies body and returns identity-service response", async () => {
  const payload = { customerId: "c-1", email: "a@b.com", name: "Alice", accessToken: "tok", refreshToken: "ref" };
  const client = makeClient(async () =>
    new Response(JSON.stringify(payload), { status: 201, headers: { "content-type": "application/json" } }),
  );

  const result = await client.register({ email: "a@b.com", password: "pass1234", name: "Alice" });
  assert.deepEqual(result, payload);
});

test("register throws ConflictException on 409", async () => {
  const client = makeClient(async () =>
    new Response(JSON.stringify({ message: "Email already registered" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  );

  await assert.rejects(
    () => client.register({ email: "a@b.com", password: "pass1234", name: "Alice" }),
    (err: unknown) => err instanceof ConflictException,
  );
});

test("login proxies body and returns tokens on 200", async () => {
  const payload = { customerId: "c-2", email: "b@b.com", name: "Bob", accessToken: "tok2", refreshToken: "ref2" };
  const client = makeClient(async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
  );

  const result = await client.login({ email: "b@b.com", password: "pass1234" });
  assert.deepEqual(result, payload);
});

test("login throws UnauthorizedException on 401", async () => {
  const client = makeClient(async () =>
    new Response(JSON.stringify({ message: "Invalid credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );

  await assert.rejects(
    () => client.login({ email: "x@x.com", password: "wrong" }),
    (err: unknown) => err instanceof UnauthorizedException,
  );
});

test("getMe forwards Authorization header and returns profile", async () => {
  let capturedAuth = "";
  const profile = { customerId: "c-3", email: "c@c.com", name: "Carol" };

  const client = makeClient(async (_url, init) => {
    capturedAuth = (init?.headers as Record<string, string>)["authorization"] ?? "";
    return new Response(JSON.stringify(profile), { status: 200, headers: { "content-type": "application/json" } });
  });

  const result = await client.getMe("Bearer valid-token");
  assert.equal(capturedAuth, "Bearer valid-token");
  assert.deepEqual(result, profile);
});

test("throws ServiceUnavailableException when identity-service is unreachable", async () => {
  const client = makeClient(async () => {
    throw new Error("ECONNREFUSED");
  });

  await assert.rejects(
    () => client.login({ email: "x@x.com", password: "pass" }),
    (err: unknown) => err instanceof ServiceUnavailableException,
  );
});
