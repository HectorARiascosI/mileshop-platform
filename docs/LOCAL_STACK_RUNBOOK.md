# MileShop local stack runbook

## Objective
Bring up the full local monorepo stack in a stable and repeatable way.

## Prerequisites
- Docker Desktop installed and running
- Node.js 20+ and npm
- PowerShell with execution policy allowing script runs

## Start stack
From the repo root:

```powershell
Set-Location "C:\Users\hecto\OneDrive\Desktop\MileShop\mileshop-platform"
.\scripts\start-local-stack.ps1
```

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
Apply the identity-service Prisma migration separately (do not reuse another service's `DATABASE_URL`):

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

```powershell
$body = '{"customerId":"customer-smoke-1","lines":[{"productId":"prod-mug-001","sku":"MILE-MUG-001","name":"Taza de cerámica","quantity":1,"unitPriceCop":28000},{"productId":"prod-bag-001","sku":"MILE-BAG-001","name":"Bolso de lona","quantity":2,"unitPriceCop":76000}]}'
Invoke-RestMethod -Uri 'http://localhost:3000/orders' -Method Post -ContentType 'application/json' -Body $body
```

Este smoke test prueba la API directamente con un `customerId` de prueba; no reemplaza el paso de contexto de cliente que exige el storefront antes de enviar el pedido.

## Verificación completa de compra

Con la stack levantada, desde la raíz del repositorio:

```powershell
npm run verify:local-purchase
```

El script crea un pedido por el gateway, lo recupera desde `orders-service` y reenvía el mismo `OrderCreated.v1` al worker. Falla si el pedido no persiste, si el total o el cliente cambian, o si el worker no responde `duplicate` ante el mismo `eventId`.

## Important notes
- Always run commands from the repo root, not from the parent folder.
- If a port is already occupied, stop the stale Node process before retrying.
- Docker must be live before the Postgres services are started.
- `npm run db:deploy` applies each Prisma migration with its explicit domain `DATABASE_URL`; do not export one shared `DATABASE_URL` when running migrations manually.
