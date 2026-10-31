# MileShop stack operations

## 1. Scope and intent

This repo is the runtime source of truth for the MileShop distributed platform. Each component owns its own responsibility and infrastructure boundary.

- `apps/web` exposes the storefront and checkout flow.
- `services/api-gateway` exposes the public HTTP entrypoint and composes domain services.
- `services/catalog-service` owns product data, available stock and atomic inventory reservations.
- `services/orders-service` owns the order lifecycle, payment-review metadata, outboxes and private payment-evidence files.
- `services/notification-worker` receives events and performs downstream notifications.
- `infra/docker-compose.yml` provisions the local Postgres instances used by the services.

## 2. Runtime map

| Component | Port | Purpose | Dependency |
| --- | ---: | --- | --- |
| API Gateway | 3000 | public facade | identity + catalog + orders |
| Notification Worker | 3010 | event receiver and notifier | PostgreSQL |
| Catalog Service | 3020 | product catalog | PostgreSQL |
| Orders Service | 3030 | order lifecycle, inventory commands, payment review and outboxes | PostgreSQL + catalog service + notification worker |
| Identity Service | 3040 | authentication and customer identity | PostgreSQL |
| Catalog Postgres | 5434 | catalog domain database | Docker |
| Notification Postgres | 5433 | notification domain database | Docker |
| Orders Postgres | 5435 | orders domain database | Docker |
| Identity Postgres | 5436 | identity domain database | Docker |

## 3. Ownership model

This is not a generic monolith. The design follows domain ownership.

### Catalog domain

- owns product definitions, sellable stock and listing logic
- exposes `GET /products` for consumer reads and authenticated internal reservation, commit and release commands
- reports sellable stock separately from inventory already reserved by pending orders
- remains the source of truth for catalog data

### Orders domain

- owns the order aggregate and validation rules
- accepts an authenticated, idempotent order command and atomically persists the order, lines, event and inventory-reservation command
- delivers outbox events to the notification worker over HTTP, with an exclusive 30-second lease, exponential backoff and an eight-attempt limit
- retries inventory reservation, commit and release commands durably and idempotently
- stores payment evidence privately; in production its configured directory must be a persistent private volume
- keeps its database isolated from the catalog domain

### Notification domain

- owns notification processing for downstream delivery
- receives the `OrderCreated.v1` request published by `orders-service`
- deduplicates by `eventId` and returns `202 Accepted` when another active lease owns processing
- does not read catalog tables directly

### API gateway

- is a composition boundary for public consumers
- does not own the database
- exposes safe HTTP routes and enforces service availability semantics
- delegates token verification to identity-service via `AuthMiddleware` on protected routes

### Identity domain

- owns customer accounts, password hashes and session refresh tokens
- exposes `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` and `GET /auth/me`
- issues JWT HS256 access tokens (15 min) and opaque refresh tokens (30 days) stored in its own database
- no other service reads identity tables directly

## 4. Required environment variables

Each service is configured explicitly and intentionally.

### Catalog service

```powershell
$env:PORT='3020'
$env:CATALOG_INVENTORY_COMMAND_TOKEN='<same-random-secret-as-orders-service>'
$env:DATABASE_URL='postgresql://catalog:catalog@localhost:5434/catalog?schema=public'
```

### Notification worker

```powershell
$env:PORT='3010'
$env:DATABASE_URL='postgresql://notifications:notifications@localhost:5433/notifications?schema=public'
```

### Orders service

```powershell
$env:PORT='3030'
$env:NOTIFICATION_WORKER_URL='http://127.0.0.1:3010'
$env:CATALOG_SERVICE_URL='http://127.0.0.1:3020'
$env:CATALOG_INVENTORY_COMMAND_TOKEN='<same-random-secret-as-catalog-service>'
$env:ORDERS_INTERNAL_TOKEN='<same-random-secret-as-api-gateway; at-least-32-characters>'
$env:PAYMENT_EVIDENCE_STORAGE='local'
$env:PAYMENT_EVIDENCE_LOCAL_DIR='<private-local-directory>'
$env:DATABASE_URL='postgresql://orders:orders@localhost:5435/orders?schema=public'
```

### API gateway

```powershell
$env:PORT='3000'
$env:CATALOG_SERVICE_URL='http://127.0.0.1:3020'
$env:ORDERS_SERVICE_URL='http://127.0.0.1:3030'
$env:IDENTITY_SERVICE_URL='http://127.0.0.1:3040'
$env:ORDERS_INTERNAL_TOKEN='<same-random-secret-as-orders-service>'
```

### Identity service

```powershell
$env:PORT='3040'
$env:DATABASE_URL='postgresql://identity:identity@localhost:5436/identity?schema=public'
$env:JWT_SECRET='<random-secret-min-32-chars>'
$env:JWT_EXPIRES_IN='15m'
$env:REFRESH_TOKEN_EXPIRES_DAYS='30'
$env:ALLOWED_ORIGINS='http://localhost:3001'
```

## 5. Startup sequence

`infra/docker-compose.yml` provisions the four local PostgreSQL databases only; it does not build, start, or stop application services. Start Docker and the databases, then apply their local migrations from the repository root:

```powershell
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
npm run db:generate
npm run db:deploy
```

Configure each application process with its own `PORT`, `DATABASE_URL` and service URLs. The inventory command token must match between Catalog and Orders; the Gateway-to-Orders token must match between Gateway and Orders. Set a non-empty local `JWT_SECRET` for Identity so login and token refresh can sign sessions. Generate secrets outside the repository and do not reuse production credentials for local testing.

The application processes must be launched and stopped separately. Do not clear ports by killing an unverified process; identify the listener and its owning workspace first. See `CONTRIBUTING.md`, section “Entorno local”, for the current database, migration and storage requirements.

## 6. Health and operational checks

Probe each running service directly:

- `http://localhost:3000/healthz`
- `http://localhost:3010/healthz`
- `http://localhost:3020/healthz`
- `http://localhost:3030/healthz`
- `http://localhost:3040/healthz`

All should respond with an HTTP 200 and a JSON payload like `{"status":"ok"}`.

## 7. Failure modes to diagnose quickly

### Port already in use

Symptom: port already in use or startup fails immediately.

Cause:
- another process is bound to the requested port; it may belong to a different MileShop workspace.

Resolution:
- inspect the listener PID and its command line/workspace before stopping anything; use alternate local ports when avoiding interference with another running workspace.

### Docker not running

Symptom: `docker compose` cannot connect or Postgres remains unavailable.

Cause:
- Docker Desktop is stopped or the daemon is not ready.

Resolution:
- start Docker Desktop and wait until the engine is healthy.

### Wrong repository

Symptom: package resolution or workspace errors such as missing `package.json` or inconsistent workspaces.

Cause:
- a command was launched outside `mileshop-platform-inventory-payments` or from the legacy `Proyecto_ventas` workspace.

Resolution:
- run from the root of `mileshop-platform-inventory-payments`; never apply these operations to the legacy workspace.

### Missing environment variables

Symptom: service boots in a degraded or partial mode, or fails to reach its database.

Cause:
- the shell process was launched without the required `PORT` and `DATABASE_URL` values.

Resolution:
- set the variables explicitly before starting the service.

## 8. Controlled shutdown

```powershell
docker compose -f infra/docker-compose.yml down
```

This stops only the PostgreSQL containers; it does not stop application processes or delete the bind-mounted database files. Do not use `docker compose down -v` or remove `infra/.data` unless intentionally discarding local database contents.

## 9. Maintainability rules

- keep each service isolated and explicitly configured
- document runtime ports and env variables in the repo
- document which processes each startup and shutdown command affects
- treat each bug as a traceable operational incident with symptom, root cause and fix
- do not mix local environment artifacts with source-controlled product behavior

## 10. Release expectations

Before merging a branch:

- run service builds and type checks
- validate health endpoints in a clean environment
- ensure docs reflect the runtime reality
- confirm no secrets or local credentials are committed
- keep the commit history readable and scoped to one responsibility at a time
