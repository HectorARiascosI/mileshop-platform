# MileShop local stack runbook

## Objective
Bring up the local database and backend services. The Next.js storefront is started separately.

## Prerequisites
- Docker Desktop installed and running
- Node.js 20+ and npm
- PowerShell with execution policy allowing script runs

## Start stack
From the repo root:

```powershell
Set-Location (git rev-parse --show-toplevel)
.\scripts\start-local-stack.ps1
```

The startup script checks ports 3000, 3010, 3020, 3030, and 3040 before starting containers or applying migrations. If a port is already in use, it reports the owning process and exits without stopping it. Inspect the stack with `.\scripts\status-local-stack.ps1`; stop a process only after confirming it belongs to MileShop.

The script starts four PostgreSQL containers, applies migrations, starts the five backend services and writes their logs under `.local-stack\logs`. It does not start `apps/web`.

To start the storefront in a second terminal:

```powershell
$env:PORT = '3001'
npm run dev --workspace apps/web
```

Port `3001` avoids the Gateway's default `3000` and matches the local Identity CORS origin.

## Port map
- API gateway: http://localhost:3000
- Notification worker: http://localhost:3010
- Catalog service: http://localhost:3020
- Orders service: http://localhost:3030
- Identity service: http://localhost:3040
- Postgres catalog: localhost:5434
- Postgres notifications: localhost:5433
- Postgres orders: localhost:5435
- Postgres identity: localhost:5436

## Health checks
```powershell
Invoke-WebRequest -Uri http://localhost:3000/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3010/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3020/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3030/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3040/healthz -UseBasicParsing
```

## Identity service migration
The startup script applies all service migrations. If provisioning Identity separately, do not reuse another service's `DATABASE_URL`:

```powershell
$env:DATABASE_URL = "postgresql://identity:identity@localhost:5436/identity?schema=public"
docker compose -f infra/docker-compose.yml up -d --wait identity-postgres
npm run db:deploy:identity-service
```

The migration is also applied automatically by `scripts/start-local-stack.ps1` via `scripts/deploy-local-databases.ps1`.

## Gateway smoke tests

```powershell
Invoke-WebRequest -Uri http://localhost:3000/catalog/products -UseBasicParsing
```

For an empty local catalog, seed the sample products once:

```powershell
$env:DATABASE_URL = "******localhost:5434/catalog?schema=public"
npm run db:seed:catalog
Remove-Item Env:DATABASE_URL
```

## Verificación completa de compra

Con la stack levantada, desde la raíz del repositorio:

```powershell
npm run verify:local-purchase
```

El script registra un cliente sintético, autentica la solicitud del pedido ante el gateway, envía una clave `Idempotency-Key`, verifica subtotal/envío/total, repite el mismo checkout y confirma que recibe el mismo `orderId`. Después recupera el pedido y reenvía `OrderCreated.v1` al worker para verificar deduplicación por `eventId`. La entrega normal la administra el outbox de `orders-service`; ante fallo del worker el pedido sigue creado y el evento queda programado para reintento.

GitHub Actions conserva esta misma validación como smoke de CI: espera que Postgres esté saludable, aplica migraciones, siembra el producto sintético, arranca los servicios (el worker en modo `log`) y falla si alguno no responde antes del timeout. El paso final ejecuta `scripts/verify-local-purchase.ps1`; no se debe reemplazar por una comprobación más débil de solo salud.

## Important notes
- Always run commands from the repo root, not from the parent folder.
- If an application port is already occupied, inspect `scripts/status-local-stack.ps1` and identify the owning process before taking action; startup exits on conflicts and does not stop processes automatically.
- `scripts/stop-local-stack.ps1` forcibly stops listeners on the five default application ports without checking their workspace. Verify each listener belongs to this repository before running it, especially when another MileShop workspace is active.
- Docker must be live before the Postgres services are started.
- `npm run db:deploy` applies each Prisma migration with its explicit domain `DATABASE_URL`; do not export one shared `DATABASE_URL` when running migrations manually.
