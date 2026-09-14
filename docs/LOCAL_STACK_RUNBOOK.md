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
- Postgres catalog: localhost:5434
- Postgres notifications: localhost:5433
- Postgres orders: localhost:5435

## Health checks
```powershell
Invoke-WebRequest -Uri http://localhost:3000/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3010/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3020/healthz -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:3030/healthz -UseBasicParsing
```

## Gateway smoke tests
```powershell
Invoke-WebRequest -Uri http://localhost:3000/catalog/products -UseBasicParsing
```

```powershell
$body = '{"customerId":"guest-user","lines":[{"productId":"prod-mug-001","sku":"MILE-MUG-001","name":"Taza de cerámica","quantity":1,"unitPriceCop":28000},{"productId":"prod-bag-001","sku":"MILE-BAG-001","name":"Bolso de lona","quantity":2,"unitPriceCop":76000}]}'
Invoke-RestMethod -Uri 'http://localhost:3000/orders' -Method Post -ContentType 'application/json' -Body $body
```

## Important notes
- Always run commands from the repo root, not from the parent folder.
- If a port is already occupied, stop the stale Node process before retrying.
- Docker must be live before the Postgres services are started.
