# API Gateway

Entrada HTTP publica de MileShop. El gateway no contiene datos de negocio: compone las APIs de los servicios y traduce sus fallos a respuestas HTTP estables.

## Desarrollo local

Desde la raiz del repositorio:

```powershell
$env:CATALOG_SERVICE_URL = "http://localhost:3020"
$env:ORDERS_SERVICE_URL = "http://localhost:3030"
$env:NOTIFICATION_WORKER_URL = "http://localhost:3010"
npm run start:dev --workspace @mileshop/api-gateway
```

Variables:

- `PORT`: puerto HTTP del gateway, por defecto `3000`.
- `CATALOG_SERVICE_URL`: URL interna de `catalog-service`, por defecto `http://localhost:3020`.
- `ORDERS_SERVICE_URL`: URL interna de `orders-service`, por defecto `http://localhost:3030`.
- `NOTIFICATION_WORKER_URL`: URL interna de `notification-worker`, por defecto `http://localhost:3010`.

Endpoints iniciales:

- `GET /healthz`
- `GET /catalog/products`
- `POST /orders`
