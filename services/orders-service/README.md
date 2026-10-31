# Orders Service

Servicio propietario de pedidos y líneas de compra. Esta capa centraliza validación, persistencia y consulta del estado de un pedido, evitando que la web o el gateway manipulen directamente el dominio.

## Responsabilidad

- Crear pedidos con validación de negocio y trazabilidad.
- Calcular subtotal, envío y total con reglas de dominio explícitas.
- Persistir el estado del pedido en su propia base de datos PostgreSQL.
- Mantener una outbox persistente de `OrderCreated.v1` y reintentar publicaciones fallidas.
- Exponer endpoints HTTP internos para consulta y creación; autenticación y autorización de clientes son responsabilidad del API Gateway.
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
- `CATALOG_SERVICE_URL`: URL interna de `catalog-service`, por defecto `http://localhost:3020`.
- `NOTIFICATION_WORKER_URL`: URL interna de `notification-worker`, por defecto `http://localhost:3010`.
- `ALLOWED_ORIGINS`: orígenes web permitidos para CORS.
- `RATE_LIMIT_MAX`: máximo de requests por ventana de tiempo. Por defecto `120`.

## Endpoints

- `GET /healthz`
- `POST /orders`
- `GET /orders/:orderId`

El gateway público exige JWT para ambos endpoints y `Idempotency-Key` en `POST /orders`. Deriva `customerId` de la sesión verificada; el servicio de pedidos no debe exponerse directamente a clientes.

## Reglas de negocio

- Un pedido debe tener al menos una línea activa.
- Cada línea debe tener cantidad positiva.
- El subtotal se calcula como suma de `unitPriceCop * quantity`; el envío es gratis desde COP 150.000 y, por debajo, corresponde al mayor entre COP 12.000 y 8 % del subtotal, redondeado al peso.
- El total persistido es subtotal más envío; el cliente no decide estos importes.
- Los pedidos comienzan en estado `PENDING`; publicar `OrderCreated.v1` no los confirma.
- La identidad de pedido es estable por `orderId`.
- Los reintentos con la misma clave UUID y el mismo cliente recuperan el pedido original; otra identidad que reutilice la clave recibe conflicto.
- Los datos de entrada se validan con Zod y el servicio no acepta payloads vacíos ni inválidos.
- Cada línea se contrasta contra el catálogo activo por `productId`, SKU, precio y stock; el nombre persistido se canonicaliza desde catálogo.
- Si el catálogo no está disponible, la creación responde como dependencia no disponible y no persiste el pedido.

El pedido, sus líneas y el evento `OrderCreated.v1` se guardan en una única transacción PostgreSQL. La publicación al worker se intenta después del commit; si falla, la outbox conserva el evento para reintento.

## Seguridad

- CORS restringido por origen configurado.
- Helmet con cabeceras de seguridad HTTP.
- Rate limiting por IP para reducir abuso y DoS.
- No se exponen secretos; la conexión a la base de datos se inyecta por variables de entorno.
