# Implementation Plan — Identity Service & Auth Flow

> **Branch naming per CONTRIBUTING.md**: each task runs on its own short-lived branch.
> **Commit convention**: Conventional Commits — one intention per commit, always compilable.
> **Verification baseline** (run from repo root after every task):
> ```powershell
> npm run typecheck && npm run lint && npm run test && npm run build
> ```
> **Per-service verification**:
> ```powershell
> npm run typecheck --workspace @mileshop/<service>
> npm run test --workspace @mileshop/<service>
> ```
> **Test runner**: `node --import tsx --test test/**/*.test.ts` (node:test + assert/strict — NO jest, NO vitest, NO describe/it).

---

## TASK 1 — Critical bug fixes

**Branch**: `fix/orders-critical-bugs`

- [ ] 1. Fix `orderId` generation in `OrderDomain.createOrder` to use `crypto.randomUUID()`.

  The current implementation uses `Date.now()` for both `orderId` and the internal `id` field, which produces collisions under concurrent load and exposes timing information. `crypto` is available as a Node.js built-in — no import needed when targeting `ES2022` with `"types": ["node"]`.

  **What to change** in `services/orders-service/src/orders.domain.ts`:
  - Replace `const orderId = \`order-${now.getTime()}\`` with `const orderId = \`order-${crypto.randomUUID()}\``.
  - Replace `id: \`order-record-${now.getTime()}\`` with `id: crypto.randomUUID()`.
  - Replace each line id `\`${orderId}-line-${index + 1}\`` with `crypto.randomUUID()` (line ids also should not be deterministic from the orderId).

  **What to add** in `services/orders-service/test/orders.service.test.ts`:
  - Add a new `test("orderId is a UUID-based string", ...)` block that calls `OrderDomain.createOrder(...)` and asserts `record.orderId` matches `/^order-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
  - The existing test `"builds the domain object with subtotal and order id"` already asserts `record.orderId.startsWith("order-")` — that test continues to pass without modification.

  **Files**: `services/orders-service/src/orders.domain.ts`, `services/orders-service/test/orders.service.test.ts`

  **Verify**: `npm run test --workspace @mileshop/orders-service` — all tests pass, including the new UUID format test.

---

- [ ] 2. Fix 404 on `GET /orders/:orderId` — throw `NotFoundException` when the order is not found.

  The current `getOrder` handler in `orders.controller.ts` returns `{ data: null }` with HTTP 200 when `findById` returns `null`, which gives the client no signal that the order doesn't exist. The fix applies the NestJS idiomatic pattern already in use in the project (other services use `NotFoundException`).

  **What to change** in `services/orders-service/src/orders.controller.ts`:
  - Add `NotFoundException` to the `@nestjs/common` import list.
  - In `getOrder`, check the result of `this.orders.getOrderById(orderId)`: if it is `null`, `throw new NotFoundException(\`Order ${orderId} not found\`)`.
  - Return `{ data: result }` only when the result is non-null.

  **What to add** in `services/orders-service/test/orders.service.test.ts`:
  - Add a test that calls `service.getOrderById("order-does-not-exist")` and asserts the return value is `null` (the service contract already returns null — the controller fix is what we verify at the controller layer).
  - Note: because tests use `InMemoryOrdersRepository` directly (not the HTTP layer), the 404 behavior is a controller concern. Add a short comment in the test file documenting that `null` from `getOrderById` is translated to HTTP 404 by the controller.

  **Files**: `services/orders-service/src/orders.controller.ts`, `services/orders-service/test/orders.service.test.ts`

  **Verify**: `npm run test --workspace @mileshop/orders-service && npm run typecheck --workspace @mileshop/orders-service` — all tests pass, no TypeScript errors.

---

- [ ] 3. Add `MILE-BTL-001` (Botella térmica) to the catalog seed.

  The seed in `catalog-service/prisma/seed.ts` currently has three products (MILE-MUG-001, MILE-BAG-001, MILE-NOTE-001). The orders-service test uses a `CatalogProduct` named "Botella térmica" which implies a fourth development product. The seed must declare all products used in development so that the local stack is consistent with the test expectations.

  **What to change** in `services/catalog-service/prisma/seed.ts`:
  - Add a fourth entry to the `products` array:
    ```ts
    {
      sku: "MILE-BTL-001",
      name: "Botella térmica",
      description: "Mantén tus bebidas a la temperatura perfecta.",
      priceCop: 65000,
      stock: 20,
    }
    ```
  - No other changes needed — the `upsert` loop and the `activeSkus` deactivation logic already handle the new product correctly.

  **Files**: `services/catalog-service/prisma/seed.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/catalog-service` passes; run `npm run db:seed --workspace @mileshop/catalog-service` against a live catalog-postgres (local stack must be running) and confirm 4 products are seeded without errors. If running in CI without a DB, typecheck alone suffices.

---

**Commit for Task 1**:
```
fix(orders): use crypto.randomUUID() for orderId generation
fix(orders): throw NotFoundException on GET /orders/:orderId when not found
fix(catalog): add MILE-BTL-001 to development seed
```

---

## TASK 2 — Identity Service

**Branch**: `feature/identity-service`

- [ ] 4. Add `identity-postgres` to the Docker Compose stack.

  Following the existing pattern for `catalog-postgres`, `orders-postgres`, and `notification-postgres` in `infra/docker-compose.yml`. The identity service gets port 5436 as specified.

  **What to add** in `infra/docker-compose.yml`:
  ```yaml
  identity-postgres:
    image: postgres:17-alpine
    container_name: mileshop-identity-postgres
    environment:
      POSTGRES_DB: identity
      POSTGRES_USER: identity
      POSTGRES_PASSWORD: identity
    ports:
      - "5436:5432"
    volumes:
      - ./.data/identity-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U identity -d identity"]
      interval: 5s
      timeout: 5s
      retries: 10
  ```

  **Files**: `infra/docker-compose.yml`

  **Verify**: `docker compose -f infra/docker-compose.yml config` exits 0 with no errors.

---

- [ ] 5. Create `services/identity-service/` workspace scaffold.

  Follow the exact pattern of `@mileshop/orders-service`: same `type: "module"`, same devDependencies versions, same scripts. Add `jsonwebtoken` and `bcryptjs` as runtime dependencies (pure-JS, no native bindings). Add `@types/jsonwebtoken` and `@types/bcryptjs` as devDependencies.

  **Files to create**:

  `services/identity-service/package.json`:
  ```json
  {
    "name": "@mileshop/identity-service",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "db:deploy": "prisma migrate deploy --schema prisma/schema.prisma",
      "db:generate": "prisma generate --schema prisma/schema.prisma",
      "start": "node dist/main.js",
      "test": "node --import tsx --test test/**/*.test.ts",
      "typecheck": "tsc -p tsconfig.json --noEmit"
    },
    "dependencies": {
      "@fastify/helmet": "^13.1.1",
      "@fastify/rate-limit": "^11.2.0",
      "@nestjs/common": "^12.0.1",
      "@nestjs/core": "^12.0.1",
      "@nestjs/platform-fastify": "^12.0.1",
      "@prisma/client": "6.12.0",
      "bcryptjs": "^3.0.2",
      "fastify": "^5.6.1",
      "jsonwebtoken": "^9.0.2",
      "reflect-metadata": "^0.2.2",
      "rxjs": "^7.8.2",
      "zod": "^4.1.5"
    },
    "devDependencies": {
      "@types/bcryptjs": "^2.4.6",
      "@types/jsonwebtoken": "^9.0.10",
      "@types/node": "^24.3.0",
      "prisma": "6.12.0",
      "tsx": "^4.20.5",
      "typescript": "^5.9.2"
    }
  }
  ```

  `services/identity-service/tsconfig.json` — copy exactly from `services/orders-service/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "dist",
      "rootDir": "src",
      "noEmit": false,
      "experimentalDecorators": true,
      "emitDecoratorMetadata": true,
      "esModuleInterop": true,
      "types": ["node"]
    },
    "include": ["src/**/*.ts"]
  }
  ```

  `services/identity-service/prisma/schema.prisma`:
  ```prisma
  generator client {
    provider = "prisma-client-js"
    output   = "../generated/identity-client"
  }

  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }

  model Customer {
    id            String         @id @default(cuid())
    email         String         @unique
    passwordHash  String
    name          String
    phone         String?
    createdAt     DateTime       @default(now())
    updatedAt     DateTime       @updatedAt
    refreshTokens RefreshToken[]

    @@index([email])
  }

  model RefreshToken {
    id         String   @id @default(cuid())
    token      String   @unique
    customerId String
    customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
    expiresAt  DateTime
    createdAt  DateTime @default(now())

    @@index([customerId])
    @@index([token])
  }
  ```

  **Files**: `services/identity-service/package.json`, `services/identity-service/tsconfig.json`, `services/identity-service/prisma/schema.prisma`

  **Verify**: `npm install` from repo root picks up the new workspace; `npm run db:generate --workspace @mileshop/identity-service` generates the Prisma client (requires DATABASE_URL env; skip if no DB available and note in commit).

---

- [ ] 6. Create domain types, validation schemas, and pure domain logic.

  These files have no I/O dependencies and can be compiled and tested in isolation.

  **`services/identity-service/src/identity.types.ts`**:
  ```ts
  export type CustomerId = string;

  export type CustomerRecord = {
    id: CustomerId;
    email: string;
    passwordHash: string;
    name: string;
    phone?: string;
    createdAt: Date;
    updatedAt: Date;
  };

  export type RefreshTokenRecord = {
    id: string;
    token: string;
    customerId: CustomerId;
    expiresAt: Date;
    createdAt: Date;
  };

  export type RegisterCommand = {
    email: string;
    password: string;
    name: string;
    phone?: string;
  };

  export type LoginCommand = {
    email: string;
    password: string;
  };

  export type AuthTokens = {
    accessToken: string;
    refreshToken: string;
  };

  export type AuthResult = AuthTokens & {
    customerId: CustomerId;
    email: string;
    name: string;
  };

  export type CustomerView = {
    customerId: CustomerId;
    email: string;
    name: string;
    phone?: string;
  };
  ```

  **`services/identity-service/src/identity.validation.ts`** — Zod schemas following the pattern in `orders.validation.ts`:
  ```ts
  import { z } from "zod";

  export const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    phone: z.string().optional(),
  });

  export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  export const refreshSchema = z.object({
    refreshToken: z.string().min(1),
  });

  export const logoutSchema = z.object({
    refreshToken: z.string().min(1),
  });
  ```

  **`services/identity-service/src/identity.domain.ts`** — pure domain logic, no I/O:
  ```ts
  import crypto from "node:crypto";
  import bcrypt from "bcryptjs";
  import type { CustomerRecord, RegisterCommand } from "./identity.types.js";

  const BCRYPT_ROUNDS = 12;

  export class IdentityDomain {
    public static async hashPassword(password: string): Promise<string> {
      return bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    public static async verifyPassword(password: string, hash: string): Promise<boolean> {
      return bcrypt.compare(password, hash);
    }

    public static generateRefreshToken(): string {
      return crypto.randomBytes(64).toString("hex");
    }

    public static buildCustomerView(record: CustomerRecord): {
      customerId: string;
      email: string;
      name: string;
      phone?: string;
    } {
      return {
        customerId: record.id,
        email: record.email,
        name: record.name,
        ...(record.phone !== undefined && { phone: record.phone }),
      };
    }
  }
  ```

  **Files**: `services/identity-service/src/identity.types.ts`, `services/identity-service/src/identity.validation.ts`, `services/identity-service/src/identity.domain.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors.

---

- [ ] 7. Create the `CustomerRepository` interface and `InMemoryCustomerRepository`.

  Follow the exact same structure as `orders.repository.ts` — a plain interface plus an in-memory implementation. The interface exposes exactly what the service needs: no leaky abstractions.

  **`services/identity-service/src/identity.repository.ts`**:
  ```ts
  import type { CustomerRecord, RefreshTokenRecord } from "./identity.types.js";

  export interface CustomerRepository {
    findByEmail(email: string): Promise<CustomerRecord | null>;
    findById(id: string): Promise<CustomerRecord | null>;
    save(customer: CustomerRecord): Promise<void>;
    saveRefreshToken(token: RefreshTokenRecord): Promise<void>;
    findRefreshToken(token: string): Promise<RefreshTokenRecord | null>;
    deleteRefreshToken(token: string): Promise<void>;
    deleteRefreshTokensByCustomerId(customerId: string): Promise<void>;
  }

  export class InMemoryCustomerRepository implements CustomerRepository {
    private readonly customers = new Map<string, CustomerRecord>();
    private readonly byEmail = new Map<string, string>(); // email → id
    private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

    public async findByEmail(email: string): Promise<CustomerRecord | null> {
      const id = this.byEmail.get(email.toLowerCase());
      if (!id) return null;
      const record = this.customers.get(id);
      return record ? structuredClone(record) : null;
    }

    public async findById(id: string): Promise<CustomerRecord | null> {
      const record = this.customers.get(id);
      return record ? structuredClone(record) : null;
    }

    public async save(customer: CustomerRecord): Promise<void> {
      this.customers.set(customer.id, structuredClone(customer));
      this.byEmail.set(customer.email.toLowerCase(), customer.id);
    }

    public async saveRefreshToken(token: RefreshTokenRecord): Promise<void> {
      this.refreshTokens.set(token.token, structuredClone(token));
    }

    public async findRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
      const record = this.refreshTokens.get(token);
      return record ? structuredClone(record) : null;
    }

    public async deleteRefreshToken(token: string): Promise<void> {
      this.refreshTokens.delete(token);
    }

    public async deleteRefreshTokensByCustomerId(customerId: string): Promise<void> {
      for (const [key, value] of this.refreshTokens.entries()) {
        if (value.customerId === customerId) {
          this.refreshTokens.delete(key);
        }
      }
    }
  }
  ```

  **Files**: `services/identity-service/src/identity.repository.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors.

---

- [ ] 8. Create `IdentityService` — JWT signing/verification and business rules.

  JWT is implemented directly with `jsonwebtoken` (no `@nestjs/jwt`, no passport). The service is a plain class with no NestJS decorators in its logic — decorators are applied in the module providers. Access token: HS256, 15 min. Refresh token: 128-byte hex string, 30 days, stored in DB.

  **`services/identity-service/src/identity.service.ts`**:

  The service exposes these methods:
  - `register(command: RegisterCommand): Promise<AuthResult>` — hashes password, saves customer, issues tokens; throws `ConflictException` if email exists.
  - `login(command: LoginCommand): Promise<AuthResult>` — looks up by email, verifies password; throws `UnauthorizedException` with a generic message (never reveal which field is wrong).
  - `refresh(refreshToken: string): Promise<AuthTokens>` — validates token existence and expiry; rotates (delete old, issue new); throws `UnauthorizedException` if invalid or expired.
  - `logout(refreshToken: string): Promise<void>` — deletes the refresh token from the DB; no error if not found.
  - `getMe(accessToken: string): Promise<CustomerView>` — verifies JWT signature and expiry using `jsonwebtoken.verify`; throws `UnauthorizedException` on any failure; looks up customer by `sub` and returns view.

  **JWT implementation detail**: `jwt.sign` and `jwt.verify` from `jsonwebtoken` are callback-based in v9. Wrap them in `new Promise(...)` for async/await. Never use a default fallback for `JWT_SECRET` — throw at startup if missing (enforce in `main.ts`).

  **Files**: `services/identity-service/src/identity.service.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors.

---

- [ ] 9. Create `PrismaService` and `PrismaCustomerRepository`.

  Copy `prisma.service.ts` verbatim from `services/orders-service/src/prisma.service.ts` but import from `../generated/identity-client/index.js`. Create `prisma.identity.repository.ts` implementing `CustomerRepository` against the Prisma-generated client.

  **`services/identity-service/src/prisma.service.ts`**:
  ```ts
  import { Injectable, OnModuleDestroy } from "@nestjs/common";
  import { PrismaClient } from "../generated/identity-client/index.js";

  @Injectable()
  export class PrismaService extends PrismaClient implements OnModuleDestroy {
    public async onModuleDestroy(): Promise<void> {
      await this.$disconnect();
    }
  }
  ```

  **`services/identity-service/src/prisma.identity.repository.ts`** — implement every method in `CustomerRepository` using `this.prisma.customer.*` and `this.prisma.refreshToken.*`. Map Prisma rows to `CustomerRecord` and `RefreshTokenRecord` types defined in `identity.types.ts`.

  **Files**: `services/identity-service/src/prisma.service.ts`, `services/identity-service/src/prisma.identity.repository.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors (requires generated Prisma client; run `npm run db:generate --workspace @mileshop/identity-service` first with a DATABASE_URL).

---

- [ ] 10. Create the thin HTTP controller with all auth endpoints.

  Follow the exact pattern of `orders.controller.ts` — a thin controller that delegates to the service and maps exceptions to HTTP responses. Never put business logic in the controller.

  **`services/identity-service/src/identity.controller.ts`**:

  Endpoints to implement:
  - `GET /healthz` → `{ status: "ok", service: "identity-service" }`
  - `POST /auth/register` → calls `service.register`; returns 201 with `{ customerId, email, name, accessToken, refreshToken }`
  - `POST /auth/login` → calls `service.login`; returns 200 with same shape
  - `POST /auth/refresh` → calls `service.refresh(body.refreshToken)`; returns 200 with `{ accessToken, refreshToken }`
  - `POST /auth/logout` → calls `service.logout(body.refreshToken)`; returns `@HttpCode(204)` with no body
  - `GET /auth/me` → reads `Authorization: Bearer <token>` from `@Headers('authorization')`, strips "Bearer ", calls `service.getMe(token)`; returns 200 with `{ customerId, email, name, phone }`

  Import `ConflictException`, `UnauthorizedException`, `HttpCode`, `Headers` from `@nestjs/common`. Let NestJS propagate exceptions thrown by the service — no try/catch in the controller for business errors.

  **Files**: `services/identity-service/src/identity.controller.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors.

---

- [ ] 11. Create `AppModule` with strategy pattern (Prisma if `DATABASE_URL`, InMemory if not).

  Follow the pattern in `services/catalog-service/src/app.module.ts` exactly — `useFactory` selects the implementation based on `process.env.DATABASE_URL`. The `IDENTITY_SERVICE` token holds an `IdentityService` instance.

  **`services/identity-service/src/app.module.ts`**:
  ```ts
  import { Module } from "@nestjs/common";
  import { IdentityController } from "./identity.controller.js";
  import { IdentityService } from "./identity.service.js";
  import { InMemoryCustomerRepository } from "./identity.repository.js";
  import { PrismaCustomerRepository } from "./prisma.identity.repository.js";
  import { PrismaService } from "./prisma.service.js";

  @Module({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      InMemoryCustomerRepository,
      {
        provide: "CUSTOMER_REPOSITORY",
        inject: [PrismaService, InMemoryCustomerRepository],
        useFactory: (prisma: PrismaService, inMemory: InMemoryCustomerRepository) =>
          process.env.DATABASE_URL ? new PrismaCustomerRepository(prisma) : inMemory,
      },
      {
        provide: "IDENTITY_SERVICE",
        inject: ["CUSTOMER_REPOSITORY"],
        useFactory: (repo: InMemoryCustomerRepository) =>
          new IdentityService(repo, {
            jwtSecret: process.env.JWT_SECRET ?? "",
            jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
            refreshTokenExpiresDays: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? 30),
          }),
      },
    ],
  })
  export class AppModule {}
  ```

  **Files**: `services/identity-service/src/app.module.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors.

---

- [ ] 12. Create `main.ts` bootstrap — same pattern as `orders-service/src/main.ts`.

  Guard `JWT_SECRET` at startup: if `process.env.JWT_SECRET` is falsy and `process.env.NODE_ENV` is `"production"`, throw before creating the app. In development the service starts without a secret (InMemory mode) but logs a warning.

  **`services/identity-service/src/main.ts`**:
  - Import `reflect-metadata`, `@fastify/helmet`, `@fastify/rate-limit`, NestJS factory and Fastify adapter — identical imports to `orders-service/src/main.ts`.
  - `PORT` defaults to `3040`.
  - Registers helmet with `contentSecurityPolicy: false` and rate-limit `max: 120`.
  - Enables CORS with `ALLOWED_ORIGINS` env var.
  - Enables shutdown hooks.
  - Logs `identity-service listening on ${port}`.

  **Files**: `services/identity-service/src/main.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/identity-service` — no errors. `npm run build --workspace @mileshop/identity-service` — emits `dist/main.js`.

---

- [ ] 13. Write tests for the identity service using `node:test` and `assert/strict`.

  **`services/identity-service/test/identity.service.test.ts`**:

  Use `InMemoryCustomerRepository` directly — no real DB. Construct `IdentityService` with a fixed `jwtSecret: "test-secret-32-chars-minimum!!"`.

  Tests to write (each a separate `test(...)` block — no `describe`, no `it`):
  1. `"registers a new customer and returns tokens"` — call `register`, assert `customerId` is a non-empty string, `accessToken` and `refreshToken` are non-empty strings, `email` matches input.
  2. `"duplicate email registration throws 409 ConflictException"` — register same email twice, assert second call rejects; verify error is a NestJS `ConflictException` (check `error.getStatus() === 409` or `error instanceof ConflictException`).
  3. `"login with correct credentials returns tokens"` — register then login, assert same `email` and non-empty tokens.
  4. `"login with wrong password throws 401 UnauthorizedException"` — register, then login with wrong password; assert rejects with status 401.
  5. `"login with unknown email throws 401 UnauthorizedException"` — login with email never registered; assert rejects with status 401.
  6. `"refresh token rotates — old token is invalid after refresh"` — register, call refresh with the refresh token, assert new tokens are returned; call refresh again with the OLD token, assert it rejects with 401.
  7. `"expired refresh token throws 401"` — manually insert a `RefreshTokenRecord` into the repository with `expiresAt` in the past, call `service.refresh(token)`, assert 401.
  8. `"logout removes the refresh token"` — register, logout with the refresh token, then try to refresh with same token and assert 401.

  Import only from `node:test`, `node:assert/strict`, and the service/repository files. No external test framework.

  **Files**: `services/identity-service/test/identity.service.test.ts`

  **Verify**: `npm run test --workspace @mileshop/identity-service` — all 8 tests pass.

---

- [ ] 14. Add `identity-service` workspace entries to root `package.json` scripts.

  The root `package.json` must include the identity service in every aggregate script so `npm run typecheck`, `npm run test`, `npm run build`, and `npm run db:generate` cover it.

  **What to add** in `package.json`:
  - `"build:identity-service": "npm run build --workspace @mileshop/identity-service"` — add to `build` script chain.
  - `"db:generate:identity-service": "npm run db:generate --workspace @mileshop/identity-service"` — add to `db:generate` chain.
  - `"db:deploy:identity-service": "npm run db:deploy --workspace @mileshop/identity-service"` — new standalone script.
  - `"test:identity-service": "npm run test --workspace @mileshop/identity-service"` — add to `test` chain.
  - Add `"typecheck:identity-service": "npm run typecheck --workspace @mileshop/identity-service"` to `typecheck:services` chain.

  **Files**: `package.json`

  **Verify**: `npm run typecheck && npm run test && npm run build` from repo root — all pass including identity-service.

---

**Commits for Task 2**:
```
feat(infra): add identity-postgres service on port 5436
feat(identity): scaffold workspace package.json and tsconfig
feat(identity): add prisma schema with Customer and RefreshToken models
feat(identity): add domain types, validation schemas and pure domain logic
feat(identity): add CustomerRepository interface and InMemoryCustomerRepository
feat(identity): implement IdentityService with JWT and bcryptjs
feat(identity): add PrismaService and PrismaCustomerRepository
feat(identity): add identity controller with all auth endpoints
feat(identity): add AppModule with strategy pattern
feat(identity): add main.ts bootstrap
test(identity): add node:test suite covering all auth scenarios
chore(root): add identity-service to root scripts
```

---

## TASK 3 — Gateway identity integration

**Branch**: `feature/gateway-identity-integration`

- [ ] 15. Create `AuthMiddleware` in the API gateway.

  NestJS middleware that extracts the `Authorization: Bearer <token>` header and calls `GET /auth/me` on the identity service. On success it attaches `customerId` and `email` to the request object. On failure it throws `UnauthorizedException`.

  **`services/api-gateway/src/auth.middleware.ts`**:
  ```ts
  import { Injectable, NestMiddleware, UnauthorizedException, Inject } from "@nestjs/common";
  import type { FastifyRequest, FastifyReply } from "fastify";

  export const IDENTITY_SERVICE_URL = "IDENTITY_SERVICE_URL";

  @Injectable()
  export class AuthMiddleware implements NestMiddleware {
    public constructor(
      @Inject("AUTH_FETCH") private readonly fetcher: typeof fetch,
      @Inject(IDENTITY_SERVICE_URL) private readonly identityServiceUrl: string,
    ) {}

    public async use(
      req: FastifyRequest["raw"] & { customerId?: string; email?: string },
      _res: FastifyReply["raw"],
      next: () => void,
    ): Promise<void> {
      const authHeader = (req.headers as Record<string, string>)["authorization"] ?? "";
      if (!authHeader.startsWith("Bearer ")) {
        throw new UnauthorizedException("Missing authorization token");
      }

      const token = authHeader.slice(7).trim();
      let response: Response;

      try {
        response = await this.fetcher(`${this.identityServiceUrl}/auth/me`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        throw new UnauthorizedException("Identity service unavailable");
      }

      if (!response.ok) {
        throw new UnauthorizedException("Invalid or expired token");
      }

      const body = (await response.json()) as {
        customerId: string;
        email: string;
        name: string;
      };

      req.customerId = body.customerId;
      req.email = body.email;
      next();
    }
  }
  ```

  **Files**: `services/api-gateway/src/auth.middleware.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/api-gateway` — no errors.

---

- [ ] 16. Protect `POST /orders` with `AuthMiddleware` and overwrite `customerId` from token.

  Apply `AuthMiddleware` only to the `POST /orders` route via `AppModule.configure`. The gateway must overwrite the `customerId` in the forwarded payload with the value extracted by the middleware — this prevents impersonation.

  **What to change** in `services/api-gateway/src/gateway.controller.ts`:
  - Import `Request` from `@nestjs/common` (the NestJS `@Req()` decorator).
  - The `createOrder` handler signature changes to:
    ```ts
    @Post("orders")
    public async createOrder(
      @Body() input: CreateOrderInput,
      @Req() req: { customerId?: string },
    ): Promise<...>
    ```
  - Inside the handler, override `input.customerId` with `req.customerId ?? input.customerId` before forwarding.

  **What to change** in `services/api-gateway/src/app.module.ts`:
  - Add `IDENTITY_SERVICE_URL` and `AuthMiddleware` imports.
  - Register `AUTH_FETCH` and `IDENTITY_SERVICE_URL` as providers:
    ```ts
    { provide: "AUTH_FETCH", useValue: fetch },
    { provide: IDENTITY_SERVICE_URL, useValue: process.env.IDENTITY_SERVICE_URL ?? "http://localhost:3040" },
    AuthMiddleware,
    ```
  - Implement `NestModule` and `configure(consumer: MiddlewareConsumer)`:
    ```ts
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AuthMiddleware).forRoutes({ path: "orders", method: RequestMethod.POST });
    }
    ```
  - Add `MiddlewareConsumer, NestModule, RequestMethod` to the `@nestjs/common` import.

  **Files**: `services/api-gateway/src/gateway.controller.ts`, `services/api-gateway/src/app.module.ts`

  **Verify**: `npm run typecheck --workspace @mileshop/api-gateway` — no errors. `npm run test --workspace @mileshop/api-gateway` — no regressions (the gateway test directory is currently empty; the typecheck alone is the gate here).

---

- [ ] 17. Add gateway test covering `AuthMiddleware` behaviour.

  **`services/api-gateway/test/auth.middleware.test.ts`** — use `node:test` + `assert/strict`. No HTTP calls; mock `fetcher` in-process.

  Tests:
  1. `"passes when identity service returns 200 with customer data"` — mock fetcher returning `{ ok: true, json: () => ({ customerId: "c-1", email: "a@b.com", name: "Test" }) }`, call `middleware.use(req, res, next)`, assert `req.customerId === "c-1"` and `next` was called.
  2. `"throws UnauthorizedException when no Bearer header"` — call with empty auth header, assert rejects with `UnauthorizedException`.
  3. `"throws UnauthorizedException when identity service returns 401"` — mock fetcher returning `{ ok: false, status: 401 }`, assert rejects.

  **Files**: `services/api-gateway/test/auth.middleware.test.ts`

  **Verify**: `npm run test --workspace @mileshop/api-gateway` — 3 new tests pass.

---

**Commits for Task 3**:
```
feat(gateway): add AuthMiddleware calling identity service /auth/me
feat(gateway): protect POST /orders with AuthMiddleware, overwrite customerId from token
feat(gateway): add IDENTITY_SERVICE_URL env var to AppModule
test(gateway): add AuthMiddleware unit tests
```

---

## TASK 4 — Frontend auth flow

**Branch**: `feature/web-auth-flow`

> **Critical**: Before writing any Next.js code, read `apps/web/node_modules/next/dist/docs/` for this version's APIs.
> This is Next.js **16.3.5** with React 19. Key confirmed APIs:
> - Route Handlers: `export async function POST(request: NextRequest)` in `app/api/.../route.ts`
> - Cookies: `import { cookies } from 'next/headers'` — async (`await cookies()`), supports `httpOnly: true`, `secure: true`, `sameSite: "lax"`
> - `Set-Cookie` via `cookies().set(name, value, options)` inside Route Handlers only
> - `NextRequest` / `Response.json(...)` are the standard
> - `params` in dynamic routes is now a `Promise` (must `await params`)

- [ ] 18. Create Next.js API Route handlers for auth cookie management.

  These three Route Handlers are the only place cookies are written. They proxy the request body to the gateway (which proxies to identity service), then set `httpOnly` cookies on success.

  **`apps/web/src/app/api/auth/register/route.ts`**:
  - `POST` handler: reads `{ email, password, name, phone? }` from request body, forwards to `${process.env.API_GATEWAY_URL ?? "http://localhost:3000"}/auth/register`
  - On success (201): calls `(await cookies()).set("accessToken", data.accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 15 * 60 })` and sets `refreshToken` with `maxAge: 30 * 24 * 60 * 60`
  - Returns `Response.json({ customerId: data.customerId, email: data.email, name: data.name }, { status: 201 })`
  - On 409 from gateway: return `Response.json({ error: "Email already registered" }, { status: 409 })`
  - On other error: return `Response.json({ error: "Registration failed" }, { status: 500 })`

  **`apps/web/src/app/api/auth/login/route.ts`**:
  - `POST` handler: reads `{ email, password }`, forwards to gateway `/auth/login`
  - On success: sets same `httpOnly` cookies (`accessToken` 15 min, `refreshToken` 30 days)
  - Returns `Response.json({ customerId, email, name })`
  - On 401: return `Response.json({ error: "Invalid credentials" }, { status: 401 })`

  **`apps/web/src/app/api/auth/logout/route.ts`**:
  - `POST` handler: reads `refreshToken` from cookies (`(await cookies()).get("refreshToken")?.value`), forwards to gateway `/auth/logout`
  - Deletes both cookies: `(await cookies()).delete("accessToken")` and `(await cookies()).delete("refreshToken")`
  - Returns `new Response(null, { status: 204 })`

  **Files**: `apps/web/src/app/api/auth/register/route.ts`, `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/logout/route.ts`

  **Verify**: `npm run typecheck --workspace apps/web` — no errors.

---

- [ ] 19. Replace the register page with a real auth registration flow.

  Replace the current `localStorage`-only implementation with a form that calls the Next.js API route, which handles the cookie. Remove all `localStorage` writes from this file.

  **What to change** in `apps/web/src/app/register/page.tsx`:
  - Add `password` field to the form state (alongside `name`, `phone`, `email`).
  - `handleSubmit` becomes `async`: calls `POST /api/auth/register` with `{ email, password, name, phone }`.
  - On success (201): `router.push("/")`.
  - On 409: `setError("Este correo ya está registrado.")`.
  - On other error: `setError("No pudimos completar el registro. Intenta de nuevo.")`.
  - Remove `CUSTOMER_ID_KEY` and `CUSTOMER_PROFILE_KEY` constants and all `localStorage.setItem` calls.
  - Password field: `<input type="password" ...>` with the same styling as the existing fields.

  **Files**: `apps/web/src/app/register/page.tsx`

  **Verify**: `npm run typecheck --workspace apps/web` — no errors.

---

- [ ] 20. Create the login page.

  **Create** `apps/web/src/app/login/page.tsx` — a `"use client"` component with email and password fields. Pattern follows the existing `register/page.tsx` structure.

  - `handleSubmit` calls `POST /api/auth/login`.
  - On success: `router.push("/")`.
  - On 401: `setError("Correo o contraseña incorrectos.")`.
  - Include a link to `/register` for new users.

  **Files**: `apps/web/src/app/login/page.tsx`

  **Verify**: `npm run typecheck --workspace apps/web` — no errors.

---

- [ ] 21. Update checkout gate in `catalog-shell.tsx` to check the `accessToken` cookie instead of `localStorage`.

  The current gate reads `window.localStorage.getItem("mileshop-customer-id-v1")`. With auth cookies, the check must use a server-readable cookie. Since `CatalogShell` is a client component (`"use client"`), it cannot use `next/headers` directly. The pattern: make a lightweight `GET /api/auth/me` fetch call to verify the session server-side.

  **What to change** in `apps/web/src/components/catalog-shell.tsx`:
  - Remove the `window.localStorage.getItem("mileshop-customer-id-v1")` check from `handleCheckout`.
  - Replace with: `const session = await fetch("/api/auth/me").then(r => r.ok ? r.json() : null)`. If `session` is null, redirect to `/login`.
  - Remove `customerId` from the order body sent to `POST /orders` — the gateway now extracts it from the `Authorization` header forwarded via the access token cookie.
  - The fetch to `/orders` must include `credentials: "include"` so the browser sends the `accessToken` cookie; the Next.js server will forward it to the gateway as `Authorization: Bearer <token>`.

  **What to add** — a new `GET /api/auth/me/route.ts` Route Handler that reads the `accessToken` cookie and calls the identity service `/auth/me` endpoint, returning the customer view or 401.

  **Files**: `apps/web/src/components/catalog-shell.tsx`, `apps/web/src/app/api/auth/me/route.ts`

  **Verify**: `npm run typecheck --workspace apps/web` — no errors.

---

**Commits for Task 4**:
```
feat(web): add Next.js API routes for auth cookie management (register, login, logout)
feat(web): replace localStorage register with real auth registration flow
feat(web): add login page
feat(web): update checkout gate to verify auth cookie instead of localStorage
```

---

## TASK 5 — Documentation

**Branch**: `docs/identity-and-auth`

- [ ] 22. Create ADR 0005 for the identity service.

  **Create** `docs/adr/0005-identity-service.md` following the format of `0004-catalog-persistence.md` (Estado/Fecha/Alcance/Contexto/Decision/Operacion local/Verificacion/Rollback).

  Sections:
  - **Contexto**: No existe dominio de identidad persistente. `customerId` es un string libre derivado del correo en localStorage. BL-03 y P0-04 del backlog exigen resolver esto.
  - **Decisión**: Se crea `services/identity-service` como bounded context de identidad propio con PostgreSQL en `:5436`. Auth con JWT HS256 (15 min) + refresh token opaco (30 días) almacenado en DB. `bcryptjs` para hash de contraseñas. `jsonwebtoken` directo sin `@nestjs/jwt` ni passport. El API gateway protege `POST /orders` con `AuthMiddleware` que delega la verificación al servicio de identidad.
  - **Consecuencias**: Los tokens no se almacenan en `localStorage`. El `customerId` que llega al servicio de pedidos está verificado por el servidor, no proviene del cliente.
  - **Alternativas consideradas**: `@nestjs/passport` + estrategias JWT (rechazado: añade dependencia innecesaria para un solo contexto). Servicio de identidad externo / Auth0 (rechazado: sin presupuesto, complejidad de integración, y el dominio es suficientemente pequeño para controlarlo internamente).

  **Files**: `docs/adr/0005-identity-service.md`

  **Verify**: File created and content is well-formed markdown. No build command needed.

---

- [ ] 23. Update `docs/wiki/architecture-overview.md`.

  **What to change**:

  1. **Section 2.1 context diagram** — add `Identity[Identity Service\n:3040]` node, add edge `Web --> Identity` and `Gateway --> Identity`, add `Identity --> IdentityDb[(Identity PostgreSQL\n:5436)]`.
  2. **Section 2.1.1 DDD context map** — add `IdentityCtx[Identidad\nautenticación y sesión]` with edges from `Customer --> IdentityCtx` (registers/logs in) and `Gateway -->|verifica token| IdentityCtx`.
  3. **Section 2.2 components** — add `Identity[identity-service]` and `IdentityDb[(Customer + RefreshToken)]` nodes and their edges. Add a row to the ownership table: `Identidad y sesión | identity-service | services/identity-service/prisma/schema.prisma`.
  4. **Section 2.3 HTTP interfaces table** — add rows for all 6 identity endpoints plus the gateway proxy entries.
  5. **Section 2.3.1 navigation flow** — add the login/register paths that now redirect to `/login` instead of just `/register`.
  6. **Section 2.4 purchase sequence** — add identity verification steps: `W->>G: POST /orders (cookie)`, `G->>I: GET /auth/me`, `I-->>G: customerId + email`, before `G->>ORD: POST /orders`.
  7. **Section 2.5 data model** — add `CUSTOMER` and `REFRESH_TOKEN` entities to the ERD.
  8. **Section 2.8 local deployment diagram** — add `Identity[identity-service :3040]` and `IDB[(identity-postgres :5436)]`.
  9. Remove the paragraph in 2.1 that says "No existe actualmente un servicio de identidad" — it will no longer be accurate.

  **Files**: `docs/wiki/architecture-overview.md`

  **Verify**: File opens without parse errors; Mermaid diagrams are syntactically valid (visually inspect).

---

- [ ] 24. Update `docs/wiki/product-backlog-v1.md`.

  **What to change**:
  - **BL-03** — Change `**Estado:** Parcial` to `**Estado:** Implementado`. Update the evidencia to reference `services/identity-service`, the JWT auth flow, and the cookie-based session. Update "Incluye hoy" to reflect real authentication and persistent customer record. Remove the "No incluye" items that are now covered.
  - **P0-04** — Change `**Estado:**` from its current unmarked state to `**Estado:** Implementado`. Fill in evidencia: `services/identity-service`, `apps/web/src/app/login`, `apps/web/src/app/register`, `AuthMiddleware` in gateway. Mark all criteria of acceptance as met.

  **Files**: `docs/wiki/product-backlog-v1.md`

  **Verify**: File opens without errors. No build command needed.

---

- [ ] 25. Update `docs/STACK_OPERATIONS.md`.

  **What to add**:

  1. In the **Runtime map table** — add a new row:
     ```
     | Identity Service | 3040 | authentication and customer identity | PostgreSQL |
     | Identity Postgres | 5436 | identity domain database | Docker |
     ```
  2. In **Section 3** (Ownership model) — add a new subsection `### Identity domain` describing what the service owns: customer records, password hashes, JWT issuance, refresh token rotation.
  3. In **Section 4** (Required environment variables) — add a new subsection `### Identity service`:
     ```powershell
     $env:PORT='3040'
     $env:DATABASE_URL='postgresql://identity:identity@localhost:5436/identity?schema=public'
     $env:JWT_SECRET='<your-secret>'
     $env:JWT_EXPIRES_IN='15m'
     $env:REFRESH_TOKEN_EXPIRES_DAYS='30'
     $env:ALLOWED_ORIGINS='http://localhost:3000'
     ```
  4. In **Section 4** under API gateway — add `$env:IDENTITY_SERVICE_URL='http://127.0.0.1:3040'`.

  **Files**: `docs/STACK_OPERATIONS.md`

  **Verify**: File opens without errors.

---

- [ ] 26. Update `docs/LOCAL_STACK_RUNBOOK.md`.

  **What to add**:
  1. In **Port map** — add `Identity service: http://localhost:3040` and `Postgres identity: localhost:5436`.
  2. Add new **Identity service migration** section:
     ```powershell
     $env:DATABASE_URL = "postgresql://identity:identity@localhost:5436/identity?schema=public"
     npm run db:deploy --workspace @mileshop/identity-service
     ```
  3. Add identity health check to the **Health checks** section:
     ```powershell
     Invoke-WebRequest -Uri http://localhost:3040/healthz -UseBasicParsing
     ```

  **Files**: `docs/LOCAL_STACK_RUNBOOK.md`

  **Verify**: File opens without errors.

---

- [ ] 27. Update PowerShell scripts.

  **`scripts/start-local-stack.ps1`**:
  - Add `$identityDatabaseUrl = 'postgresql://identity:identity@localhost:5436/identity?schema=public'` alongside other URL variables.
  - Add identity-service to the `$jobs` array: `@{ Port = '3040'; Workspace = '@mileshop/identity-service'; EnvMap = @{ DATABASE_URL = $identityDatabaseUrl; JWT_SECRET = $env:JWT_SECRET ?? 'dev-only-secret-change-in-prod'; JWT_EXPIRES_IN = '15m'; ALLOWED_ORIGINS = 'http://localhost:3000' } }`.
  - Add `identityEnv` hashtable for gateway: add `IDENTITY_SERVICE_URL = 'http://127.0.0.1:3040'` to `$gatewayEnv`.
  - Add to port-clearing step: `Get-NetTCPConnection -LocalPort 3000,3010,3020,3030,3040 ...`
  - Add `Wait-ForHttp -Uri 'http://localhost:3040/healthz' -TimeoutSeconds 60`.
  - Add health check `Invoke-WebRequest -Uri 'http://localhost:3040/healthz'`.

  **`scripts/stop-local-stack.ps1`**:
  - Add port 3040 to the `Get-NetTCPConnection -LocalPort 3000,3010,3020,3030,3040` call.

  **`scripts/status-local-stack.ps1`**:
  - Add `3040` to the `$ports` array.
  - Add `@{ Name = 'Identity service'; Url = 'http://localhost:3040/healthz' }` to `$checks`.

  **`scripts/deploy-local-databases.ps1`**:
  - Add identity service migration entry to the `$databases` array:
    ```powershell
    @{ Name = 'identity-service'; WorkspaceScript = 'db:deploy:identity-service'; Url = 'postgresql://identity:identity@localhost:5436/identity?schema=public' }
    ```

  **Files**: `scripts/start-local-stack.ps1`, `scripts/stop-local-stack.ps1`, `scripts/status-local-stack.ps1`, `scripts/deploy-local-databases.ps1`

  **Verify**: `docker compose -f infra/docker-compose.yml config` exits 0. The scripts are syntactically valid PowerShell (`Get-Command ... -Syntax` or inspect in an editor).

---

**Commits for Task 5**:
```
docs(adr): add ADR 0005 for identity service decision
docs(arch): update architecture overview with identity service
docs(backlog): mark BL-03 and P0-04 as Implemented
docs(ops): add identity-service to STACK_OPERATIONS.md
docs(runbook): add identity-service to LOCAL_STACK_RUNBOOK.md
chore(scripts): add identity-service and identity-postgres to all local stack scripts
```

---

## Cross-cutting verification (after all tasks)

Run from the repo root in order:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
docker compose -f infra/docker-compose.yml config
```

All commands must exit 0. No TypeScript errors, no lint errors, all unit tests green, all services build to `dist/`.

Per-service final check:
```powershell
npm run typecheck --workspace @mileshop/api-gateway
npm run typecheck --workspace @mileshop/catalog-service
npm run typecheck --workspace @mileshop/orders-service
npm run typecheck --workspace @mileshop/identity-service
npm run test --workspace @mileshop/orders-service
npm run test --workspace @mileshop/identity-service
npm run test --workspace @mileshop/api-gateway
```

---

## Dependency order summary

```
Task 1 (bug fixes) — independent, no dependencies
Task 2 (identity-service) — depends on Docker Compose change (step 4)
Task 3 (gateway integration) — depends on identity-service types/interface (task 2)
Task 4 (web auth flow) — depends on gateway routes being defined (task 3)
Task 5 (docs) — depends on all above being implemented
```

Each task produces a buildable state on its own branch. The gateway integration (Task 3) can import types from `@mileshop/identity-service` only if the workspace is present (it will be after Task 2). Tasks 3 and 4 must not be merged to `develop` before Task 2 is merged.
