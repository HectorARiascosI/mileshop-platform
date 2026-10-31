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
Set-Location (git rev-parse --show-toplevel)
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

## Health and readiness checks
```powershell
Invoke-WebRequest -Uri http://localhost:3000/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3000/readyz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3010/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3010/readyz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3020/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3020/readyz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3030/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3030/readyz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3040/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3040/readyz -UseBasicParsing
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

La creación de pedidos requiere sesión autenticada y `Idempotency-Key`; usa `npm run verify:local-purchase` para ejecutar ese flujo completo con las cabeceras correctas. No envíes `customerId` como autoridad desde el cliente.

## Verificación completa de compra

Con la stack levantada, desde la raíz del repositorio:

```powershell
npm run verify:local-purchase
```

El script crea un pedido autenticado por el gateway, repite la misma solicitud con idéntica clave de idempotencia, consulta el pedido y su estado por el gateway y reenvía el mismo `OrderCreated.v1` al worker. Falla si el reintento crea otro pedido, si el subtotal, envío, total o cliente cambian, si el estado inicial no es `PENDING`, o si el worker no responde `duplicate` ante el mismo `eventId`.

El backend es la fuente de verdad de los importes: envío gratis desde COP 150.000; por debajo del umbral, se cobra el mayor entre COP 12.000 y el 8 % del subtotal, redondeado al peso. El carrito muestra una estimación; la confirmación y el detalle usan los importes persistidos.

## Recuperación de notificaciones

`orders-service` guarda el pedido, sus líneas y el evento de outbox en una única transacción PostgreSQL. La publicación HTTP al worker ocurre después del commit; si falla, el servicio conserva el evento y lo reintenta con backoff exponencial: programa el primer reintento para 5 segundos, duplica la espera hasta un máximo de 5 minutos y sondea el outbox cada 5 segundos. El máximo es de 8 intentos totales, incluido el envío inicial. Los eventos agotados quedan con estado `FAILED` y no se reintentan automáticamente; revisa `lastError` e investiga antes de reencolarlos. No hay broker externo.

## Important notes
- Always run commands from the repo root, not from the parent folder.
- If a port is already occupied, inspect `scripts/status-local-stack.ps1` and identify the owning process before taking action; do not stop an unrelated process.
- Docker must be live before the Postgres services are started.
- `npm run db:deploy` applies each Prisma migration with its explicit domain `DATABASE_URL`; do not export one shared `DATABASE_URL` when running migrations manually.
