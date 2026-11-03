import assert from "node:assert/strict";
import { test } from "node:test";

import { UnauthorizedException } from "@nestjs/common";

import { AuthMiddleware } from "../src/auth.middleware.js";

const BASE_URL = "http://localhost:3040";

test("passes when identity service returns 200 with customer data", async () => {
  let forwardedAuthorization: string | null = null;
  const mockFetcher = async (_url: string, init?: RequestInit): Promise<Response> => {
    forwardedAuthorization = new Headers(init?.headers).get("authorization");
    return ({
      ok: true,
      json: async () => ({ customerId: "c-1", email: "a@b.com", name: "Test" }),
    }) as unknown as Response;
  };

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = {
    headers: { authorization: "Bearer test-token" },
    customerId: undefined as string | undefined,
    email: undefined as string | undefined,
  };

  let nextCalled = false;
  const next = (): void => {
    nextCalled = true;
  };

  await middleware.use(req as any, {} as any, next);

  assert.equal(req.customerId, "c-1");
  assert.equal(forwardedAuthorization, "Bearer test-token");
  assert.equal(nextCalled, true);
});

test("throws UnauthorizedException when no authorization header", async () => {
  const mockFetcher = async (): Promise<Response> => ({ ok: true } as Response);
  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof UnauthorizedException,
  );
});

test("throws UnauthorizedException when identity service returns 401", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({ ok: false, status: 401 }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer test-token" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof UnauthorizedException,
  );
});
