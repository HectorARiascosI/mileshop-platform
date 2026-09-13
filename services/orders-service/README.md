# Orders Service

Servicio propietario de pedidos y líneas de compra. Esta capa centraliza validación, persistencia y consulta del estado de un pedido, evitando que la web o el gateway manipulen directamente el dominio.

## Responsabilidad

- Crear pedidos con validación de negocio y trazabilidad.
- Calcular subtotal, total y líneas del pedido con reglas de dominio explícitas.
- Persistir el estado del pedido en su propia base de datos PostgreSQL.
- Exponer endpoints HTTP seguros para consulta y creación.
- Mantener la base de datos fuera del alcance del catálogo, notificaciones y gateway.

## Base de datos

La base de datos del servicio pertenece exclusivamente a la capa de órdenes.

- Schema: `orders`
- Usuario: `orders`
- Puerto local: `5435`
- Repositorio: `infra/docker-compose.yml`

Comandos de referencia:

```bash
docker compose -f infra/docker-compose.yml up -d orders-postgres
npm run db:generate --workspace @mileshop/orders-service
npm run db:deploy --workspace @mileshop/orders-service
```

## Variables de entorno

- `DATABASE_URL`: conexión exclusiva para PostgreSQL del servicio de pedidos.
- `PORT`: puerto HTTP del servicio. Por defecto `3030`.
- `ALLOWED_ORIGINS`: orígenes web permitidos para CORS.
- `RATE_LIMIT_MAX`: máximo de requests por ventana de tiempo. Por defecto `120`.

## Endpoints

- `GET /healthz`
- `POST /orders`
- `GET /orders/:orderId`

## Reglas de negocio

- Un pedido debe tener al menos una línea activa.
- Cada línea debe tener cantidad positiva.
- El total se calcula como suma de `unitPriceCop * quantity`.
- La identidad de pedido es estable por `orderId`.
- Los datos de entrada se validan con Zod y el servicio no acepta payloads vacíos ni inválidos.

## Seguridad

- CORS restringido por origen configurado.
- Helmet con cabeceras de seguridad HTTP.
- Rate limiting por IP para reducir abuso y DoS.
- No se exponen secretos; la conexión a la base de datos se inyecta por variables de entorno.
