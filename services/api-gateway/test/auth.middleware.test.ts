import assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";

import { AuthMiddleware } from "../src/auth.middleware.js";

const BASE_URL = "http://localhost:3040";

test("passes when identity service returns 200 with customer data", async () => {
  const mockFetcher = async (_url: string, _init?: RequestInit): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({
        customerId: "c-1",
        email: "a@b.com",
        name: "Test",
        role: "CUSTOMER",
      }),
    }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = {
    headers: { authorization: "Bearer valid-token" },
    customerId: undefined as string | undefined,
    email: undefined as string | undefined,
    role: undefined as "CUSTOMER" | "STORE_ADMIN" | undefined,
  };

  let nextCalled = false;
  const next = (): void => {
    nextCalled = true;
  };

  await middleware.use(req as any, {} as any, next);

  assert.equal(req.customerId, "c-1");
  assert.equal(req.role, "CUSTOMER");
  assert.equal(nextCalled, true);
});

test("propagates a verified store-admin role from identity", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({
        customerId: "admin-1",
        email: "owner@example.com",
        role: "STORE_ADMIN",
      }),
    }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = {
    headers: { authorization: "Bearer token" },
    customerId: undefined as string | undefined,
    email: undefined as string | undefined,
    role: undefined as "CUSTOMER" | "STORE_ADMIN" | undefined,
  };

  await middleware.use(req as any, {} as any, () => {});

  assert.equal(req.customerId, "admin-1");
  assert.equal(req.role, "STORE_ADMIN");
});

test("uses the role returned by identity rather than a pre-populated request role", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({
        customerId: "c-1",
        email: "a@b.com",
        role: "CUSTOMER",
      }),
    }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = {
    headers: { authorization: "Bearer token" },
    customerId: undefined as string | undefined,
    email: undefined as string | undefined,
    role: "STORE_ADMIN" as "CUSTOMER" | "STORE_ADMIN" | undefined,
  };

  await middleware.use(req as any, {} as any, () => {});

  assert.equal(req.role, "CUSTOMER");
});

test("throws UnauthorizedException when no Bearer header", async () => {
  const mockFetcher = async (): Promise<Response> => ({ ok: true } as Response);
  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof UnauthorizedException,
  );
});

test("throws UnauthorizedException when the bearer token is empty", async () => {
  const mockFetcher = async (): Promise<Response> => ({ ok: true } as Response);
  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer   " } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof UnauthorizedException,
  );
});

test("throws UnauthorizedException when identity service returns 401", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({ ok: false, status: 401 }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer bad-token" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof UnauthorizedException,
  );
});

test("throws ServiceUnavailableException when identity service returns 500", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({ ok: false, status: 500 }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer valid-token" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof ServiceUnavailableException,
  );
});

test("throws ServiceUnavailableException when identity service is unreachable", async () => {
  const mockFetcher = async (): Promise<Response> => {
    throw new TypeError("fetch failed");
  };

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer valid-token" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof ServiceUnavailableException,
  );
});

test("throws ServiceUnavailableException when identity response is malformed", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({ email: "a@b.com" }),
    }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer valid-token" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof ServiceUnavailableException,
  );
});

test("throws ServiceUnavailableException when identity returns an unknown role", async () => {
  const mockFetcher = async (): Promise<Response> =>
    ({
      ok: true,
      json: async () => ({
        customerId: "c-1",
        email: "a@b.com",
        role: "SUPERUSER",
      }),
    }) as unknown as Response;

  const middleware = new AuthMiddleware(mockFetcher as typeof fetch, BASE_URL);
  const req = { headers: { authorization: "Bearer token" } };

  await assert.rejects(
    () => middleware.use(req as any, {} as any, () => {}),
    (err: unknown) => err instanceof ServiceUnavailableException,
  );
});
