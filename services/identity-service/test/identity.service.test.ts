import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { IdentityService } from "../src/identity.service.js";
import { InMemoryCustomerRepository } from "../src/identity.repository.js";

const TEST_CONFIG = {
  jwtSecret: "test-secret-32-chars-minimum!!",
  jwtExpiresIn: "15m",
  refreshTokenExpiresDays: 30,
};

function makeService(): { repo: InMemoryCustomerRepository; service: IdentityService } {
  const repo = new InMemoryCustomerRepository();
  const service = new IdentityService(repo, TEST_CONFIG);
  return { repo, service };
}

test("registers a new customer and returns tokens", async () => {
  const { service } = makeService();
  const result = await service.register({
    email: "alice@example.com",
    password: "password123",
    name: "Alice",
  });

  assert.ok(result.customerId.length > 0, "customerId should be non-empty");
  assert.ok(result.accessToken.length > 0, "accessToken should be non-empty");
  assert.ok(result.refreshToken.length > 0, "refreshToken should be non-empty");
  assert.equal(result.email, "alice@example.com");
});

test("duplicate email registration throws 409 ConflictException", async () => {
  const { service } = makeService();
  await service.register({
    email: "alice@example.com",
    password: "password123",
    name: "Alice",
  });

  await assert.rejects(
    () =>
      service.register({
        email: "alice@example.com",
        password: "different-pass",
        name: "Alice2",
      }),
    (error: unknown) => {
      assert.ok(
        error instanceof ConflictException || (error instanceof Error && (error as any).getStatus?.() === 409),
        "expected ConflictException",
      );
      return true;
    },
  );
});

test("login with correct credentials returns tokens", async () => {
  const { service } = makeService();
  await service.register({
    email: "bob@example.com",
    password: "mypassword1",
    name: "Bob",
  });

  const result = await service.login({
    email: "bob@example.com",
    password: "mypassword1",
  });

  assert.equal(result.email, "bob@example.com");
  assert.ok(result.accessToken.length > 0, "accessToken should be non-empty");
  assert.ok(result.refreshToken.length > 0, "refreshToken should be non-empty");
});

test("login with wrong password throws 401 UnauthorizedException", async () => {
  const { service } = makeService();
  await service.register({
    email: "carol@example.com",
    password: "correctpass1",
    name: "Carol",
  });

  await assert.rejects(
    () => service.login({ email: "carol@example.com", password: "wrongpassword" }),
    (error: unknown) => {
      assert.ok(
        error instanceof UnauthorizedException || (error instanceof Error && (error as any).getStatus?.() === 401),
        "expected UnauthorizedException",
      );
      return true;
    },
  );
});

test("login with unknown email throws 401 UnauthorizedException", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.login({ email: "nobody@example.com", password: "somepassword" }),
    (error: unknown) => {
      assert.ok(
        error instanceof UnauthorizedException || (error instanceof Error && (error as any).getStatus?.() === 401),
        "expected UnauthorizedException",
      );
      return true;
    },
  );
});

test("refresh token rotates — old token is invalid after refresh", async () => {
  const { service } = makeService();
  const { refreshToken: firstToken } = await service.register({
    email: "dave@example.com",
    password: "password123",
    name: "Dave",
  });

  const { refreshToken: secondToken } = await service.refresh(firstToken);
  assert.ok(secondToken.length > 0, "new refreshToken should be non-empty");
  assert.notEqual(secondToken, firstToken, "tokens should be different");

  await assert.rejects(
    () => service.refresh(firstToken),
    (error: unknown) => {
      assert.ok(
        error instanceof UnauthorizedException || (error instanceof Error && (error as any).getStatus?.() === 401),
        "expected UnauthorizedException for old token",
      );
      return true;
    },
  );
});

test("expired refresh token throws 401", async () => {
  const { repo, service } = makeService();
  const registered = await service.register({
    email: "eve@example.com",
    password: "password123",
    name: "Eve",
  });

  const expiredToken = "expired-token-string";
  await repo.saveRefreshToken({
    id: "test-id-expired",
    token: expiredToken,
    customerId: registered.customerId,
    expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    createdAt: new Date(),
  });

  await assert.rejects(
    () => service.refresh(expiredToken),
    (error: unknown) => {
      assert.ok(
        error instanceof UnauthorizedException || (error instanceof Error && (error as any).getStatus?.() === 401),
        "expected UnauthorizedException for expired token",
      );
      return true;
    },
  );
});

test("logout removes the refresh token", async () => {
  const { service } = makeService();
  const { refreshToken } = await service.register({
    email: "frank@example.com",
    password: "password123",
    name: "Frank",
  });

  await service.logout(refreshToken);

  await assert.rejects(
    () => service.refresh(refreshToken),
    (error: unknown) => {
      assert.ok(
        error instanceof UnauthorizedException || (error instanceof Error && (error as any).getStatus?.() === 401),
        "expected UnauthorizedException after logout",
      );
      return true;
    },
  );
});
