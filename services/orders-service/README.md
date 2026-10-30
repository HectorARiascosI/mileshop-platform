# Orders Service

Servicio propietario de pedidos y líneas de compra. Esta capa centraliza validación, persistencia y consulta del estado de un pedido, evitando que la web o el gateway manipulen directamente el dominio.

## Responsabilidad

- Crear pedidos con validación de negocio y trazabilidad.
- Calcular subtotal, envío y total con reglas de dominio explícitas.
- Persistir el estado del pedido en su propia base de datos PostgreSQL.
- Guardar el pedido y su evento `OrderCreated.v1` en una única transacción.
- Entregar eventos pendientes con reintentos, backoff y leases recuperables.
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
- `NOTIFICATION_WORKER_URL`: endpoint interno del worker. Por defecto `http://localhost:3010`.
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
- El subtotal se calcula como suma de `unitPriceCop * quantity`; el envío y el total se calculan en servidor.
- La identidad de pedido es estable por `orderId`.
- Los datos de entrada se validan con Zod y el servicio no acepta payloads vacíos ni inválidos.
- `POST /orders` requiere `Idempotency-Key` UUID; errores de validación son `400`, reuso incompatible de clave `409` y fallos de persistencia conservan el código `500`.
- Cada línea se contrasta contra el catálogo activo por `productId`, SKU, precio y stock; el nombre persistido se canonicaliza desde catálogo.
- Si el catálogo no está disponible, la creación responde como dependencia no disponible y no persiste el pedido.
- La tarifa es gratuita desde COP 150.000; por debajo de ese umbral es el mayor valor entre COP 12.000 y el 8 % del subtotal.
- `POST /orders` requiere un encabezado `Idempotency-Key` UUID. Repetir clave y contenido devuelve el pedido original; repetir la clave con contenido distinto produce `409 Conflict`.
- Persistencia, líneas y evento outbox se confirman o revierten juntas. La entrega se considera al menos una vez: el consumidor deduplica por `eventId`.
- Las reclamaciones del outbox vencen a los 30 segundos y se recuperan en el siguiente ciclo; tras ocho intentos el evento queda en `FAILED` para intervención operativa.

El servicio no reserva ni descuenta inventario. La validación actual de stock es una lectura de catálogo y no evita sobreventa entre compras concurrentes; esa política requiere una decisión de negocio y una operación atómica del inventario.

## Seguridad

- CORS restringido por origen configurado.
- Helmet con cabeceras de seguridad HTTP.
- Rate limiting por IP para reducir abuso y DoS.
- No se exponen secretos; la conexión a la base de datos se inyecta por variables de entorno.
