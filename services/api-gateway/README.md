# API Gateway

Entrada HTTP publica de MileShop. El gateway no contiene datos de negocio: compone las APIs de los servicios y traduce sus fallos a respuestas HTTP estables.

## Desarrollo local

Desde la raiz del repositorio:

```powershell
$env:CATALOG_SERVICE_URL = "http://localhost:3020"
$env:ORDERS_SERVICE_URL = "http://localhost:3030"
$env:IDENTITY_SERVICE_URL = "http://localhost:3040"
npm run start:dev --workspace @mileshop/api-gateway
```

Variables:

- `PORT`: puerto HTTP del gateway, por defecto `3000`.
- `CATALOG_SERVICE_URL`: URL interna de `catalog-service`, por defecto `http://localhost:3020`.
- `ORDERS_SERVICE_URL`: URL interna de `orders-service`, por defecto `http://localhost:3030`.
- `IDENTITY_SERVICE_URL`: URL interna de `identity-service`, por defecto `http://localhost:3040`.

Endpoints iniciales:

- `GET /healthz`
- `GET /catalog/products`
- `POST /orders` (requiere JWT y el encabezado `Idempotency-Key`)
- `GET /orders/:orderId` (requiere JWT; oculta pedidos de otros clientes)
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

El gateway verifica la sesión, obtiene el `customerId` de la identidad validada y lo pasa a `orders-service`; nunca acepta un `customerId` del cuerpo como autoridad. El servicio de pedidos calcula y persiste los importes, el estado y la clave idempotente. La consulta de un pedido valida su propietario antes de devolverlo.
