# MileShop stack operations

## 1. Scope and intent

This repo is the runtime source of truth for the MileShop distributed platform. Each component owns its own responsibility and infrastructure boundary.

- `apps/web` exposes the storefront and checkout flow.
- `services/api-gateway` exposes the public HTTP entrypoint and composes domain services.
- `services/catalog-service` owns the product catalog domain and its data model.
- `services/orders-service` owns order creation and validation rules.
- `services/notification-worker` receives events and performs downstream notifications.
- `infra/docker-compose.yml` provisions the local Postgres instances used by the services.

## 2. Runtime map

| Component | Port | Purpose | Dependency |
| --- | ---: | --- | --- |
| API Gateway | 3000 | public facade | identity + catalog + orders |
| Notification Worker | 3010 | event receiver and notifier | PostgreSQL |
| Catalog Service | 3020 | product catalog | PostgreSQL |
| Orders Service | 3030 | order creation, outbox delivery and catalog validation | PostgreSQL + catalog service + notification worker |
| Identity Service | 3040 | authentication and customer identity | PostgreSQL |
| Catalog Postgres | 5434 | catalog domain database | Docker |
| Notification Postgres | 5433 | notification domain database | Docker |
| Orders Postgres | 5435 | orders domain database | Docker |
| Identity Postgres | 5436 | identity domain database | Docker |

## 3. Ownership model

This is not a generic monolith. The design follows domain ownership.

### Catalog domain

- owns product definitions, stock and listing logic
- exposes `GET /products` for consumer reads
- remains the source of truth for catalog data

### Orders domain

- owns the order aggregate and validation rules
- accepts an authenticated, idempotent order command and persists the order, lines and `OrderCreated.v1` outbox row atomically
- delivers outbox events to the notification worker over HTTP, with an exclusive 30-second lease, exponential backoff and an eight-attempt limit
- keeps its database isolated from the catalog domain
- does not reserve or decrement stock; concurrent orders can still oversell until inventory ownership and reservation semantics are decided

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
- exposes `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` and `POST /auth/verify-token`
- issues JWT HS256 access tokens (15 min) and opaque refresh tokens (30 days) stored in its own database
- no other service reads identity tables directly

## 4. Required environment variables

Each service is configured explicitly and intentionally.

### Catalog service

```powershell
$env:PORT='3020'
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
$env:DATABASE_URL='postgresql://orders:orders@localhost:5435/orders?schema=public'
```

### API gateway

```powershell
$env:PORT='3000'
$env:CATALOG_SERVICE_URL='http://127.0.0.1:3020'
$env:ORDERS_SERVICE_URL='http://127.0.0.1:3030'
$env:IDENTITY_SERVICE_URL='http://127.0.0.1:3040'
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

1. Ensure Docker Desktop is running.
2. Run the repository-local startup script from the repo root:

```powershell
Set-Location "C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform"
.\scripts\start-local-stack.ps1
```

3. The script performs the following in order:
   - validates Docker availability
   - starts the Postgres compose stack
   - applies Prisma migrations for the four service databases
   - clears stale listeners on ports 3000, 3010, 3020, 3030 and 3040
   - launches the five application services as independent processes with env-specific variables
   - waits until each service health endpoint is available
   - executes smoke checks against the gateway and catalog flow

The migration command is centralized in `scripts/deploy-local-databases.ps1`, which assigns the catalog, notification, and orders database URL separately. This prevents a shell-level `DATABASE_URL` from applying a migration to the wrong domain.

## 6. Health and operational checks

Use the repository status script to inspect the current runtime state:

```powershell
Set-Location "C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform"
.\scripts\status-local-stack.ps1
```

Expected checks:

- `http://localhost:3000/healthz`
- `http://localhost:3010/healthz`
- `http://localhost:3020/healthz`
- `http://localhost:3030/healthz`
- `http://localhost:3040/healthz`

All should respond with an HTTP 200 and a JSON payload like `{"status":"ok"}`.

## 7. Failure modes to diagnose quickly

### Stale ports

Symptom: port already in use or startup fails immediately.

Cause:
- an old Node process is still bound to 3000, 3010, 3020, 3030 or 3040.

Resolution:
- run the stop script or clear the owning process with PowerShell.

### Docker not running

Symptom: `docker compose` cannot connect or Postgres remains unavailable.

Cause:
- Docker Desktop is stopped or the daemon is not ready.

Resolution:
- start Docker Desktop and wait until the engine is healthy.

### Wrong working directory

Symptom: package resolution or workspace errors such as missing `package.json` or inconsistent workspaces.

Cause:
- the command was launched outside the monorepo root.

Resolution:
- always run from `C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform`.

### Missing environment variables

Symptom: service boots in a degraded or partial mode, or fails to reach its database.

Cause:
- the shell process was launched without the required `PORT` and `DATABASE_URL` values.

Resolution:
- set the variables explicitly before starting the service.

## 8. Controlled shutdown

```powershell
Set-Location "C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform"
.\scripts\stop-local-stack.ps1
```

The stop flow does the following:
- kills stale listeners on the app ports
- runs `docker compose down` for the Postgres stack
- leaves the repo in a clean, restartable state

## 9. Maintainability rules

- keep each service isolated and explicitly configured
- document runtime ports and env variables in the repo
- prefer script-driven startup and shutdown instead of ad hoc terminal launches
- treat each bug as a traceable operational incident with symptom, root cause and fix
- do not mix local environment artifacts with source-controlled product behavior

## 10. Release expectations

Before merging a branch:

- run service builds and type checks
- validate health endpoints in a clean environment
- ensure docs reflect the runtime reality
- confirm no secrets or local credentials are committed
- keep the commit history readable and scoped to one responsibility at a time
