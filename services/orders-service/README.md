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
- `CATALOG_RESERVATION_TOKEN` y `CATALOG_INVENTORY_COMMAND_TOKEN`: secretos compartidos con Catálogo.
- `ORDERS_INTERNAL_TOKEN`: secreto compartido con API Gateway; en producción debe tener al menos 32 caracteres.
- `CRON_SECRET`: secreto para el mantenimiento programado.
- `ALLOWED_ORIGINS`: orígenes web permitidos para CORS.
- `RATE_LIMIT_MAX`: máximo de requests por ventana de tiempo. Por defecto `120`.

En Vercel, configura URLs HTTPS terminadas en `/api` para los servicios remotos y una URL pooled de Neon para `DATABASE_URL`. La guía de los seis proyectos, variables y migraciones está en [`docs/DEPLOYMENT-VERCEL-NEON.md`](../../docs/DEPLOYMENT-VERCEL-NEON.md).

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /orders`
- `GET /orders/:orderId`
- `POST /orders/:orderId/cancel`
- `GET /admin/orders`
- `POST /admin/orders/:orderId/confirm`
- `POST /admin/orders/:orderId/cancel`

Las rutas de negocio deben recibirse desde API Gateway, que verifica el JWT y transmite la identidad autenticada junto con `ORDERS_INTERNAL_TOKEN`. Orders valida ese token; no debe exponerse directamente a clientes sin esa frontera.

## Reglas de negocio

- Un pedido debe tener al menos una línea activa.
- Cada línea debe tener cantidad positiva.
- El subtotal se calcula como suma de `unitPriceCop * quantity`; el envío es gratis desde COP 150.000 y, por debajo, corresponde al mayor entre COP 12.000 y 8 % del subtotal, redondeado al peso.
- El total persistido es subtotal más envío; el cliente no decide estos importes.
- El pedido reserva inventario durante su creación y permanece pendiente de confirmación administrativa o cancelación; no libera stock por vencimiento en la configuración Vercel.
- El pago se coordina manualmente por WhatsApp Business; no existe pasarela de pago.
- La identidad de pedido es estable por `orderId`.
- Los reintentos con la misma clave UUID y el mismo cliente recuperan el pedido original; otra identidad que reutilice la clave recibe conflicto.
- Los datos de entrada se validan con Zod y el servicio no acepta payloads vacíos ni inválidos.
- Cada línea se contrasta contra el catálogo activo por `productId`, SKU, precio y stock; el nombre persistido se canonicaliza desde catálogo.
- Si el catálogo no está disponible, la creación responde como dependencia no disponible y no persiste el pedido.

La publicación de `OrderCreated.v1` se intenta después de persistir el pedido. Si falla, la outbox conserva el evento para reintento. En Vercel no hay timers residentes: el cron diario de `/internal/maintenance` solo recupera trabajo pendiente y no forma parte del flujo síncrono de reserva.

El proveedor de almacenamiento de comprobantes no está registrado en `AppModule`; sus rutas responden con error explícito y no deben usarse en Vercel. El flujo actual comparte el pedido por WhatsApp, y la administradora valida el pago fuera de la plataforma.

## Seguridad

- CORS restringido por origen configurado.
- Helmet con cabeceras de seguridad HTTP.
- Rate limiting por IP para reducir abuso y DoS.
- No se exponen secretos; la conexión a la base de datos se inyecta por variables de entorno.
