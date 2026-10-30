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

## Autenticación y sesión

Endpoints de identidad expuestos por el gateway:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

`POST /orders` valida el access token consultando `identity-service`. Un token ausente, inválido o expirado produce `401 Unauthorized`. Si identidad no responde, devuelve un error de servidor o entrega una respuesta inválida, el gateway responde `503 Service Unavailable`; una interrupción de identidad no debe tratarse como si el cliente hubiera cerrado sesión.

La aplicación web guarda access y refresh tokens en cookies `httpOnly`. `GET /api/auth/me` intenta renovar la sesión si el access token expiró; solo elimina las cookies cuando identidad rechaza el refresh token con `401`. Errores de red y respuestas de servidor conservan las cookies para permitir reintentar.

Endpoints iniciales:

- `GET /healthz`
- `GET /catalog/products`
- `POST /orders`
