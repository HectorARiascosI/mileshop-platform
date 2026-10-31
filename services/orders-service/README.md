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
- `PAYMENT_EVIDENCE_STORAGE`: actualmente solo admite `local`; en producción exige un directorio absoluto respaldado por un volumen privado persistente.
- `PAYMENT_EVIDENCE_LOCAL_DIR`: directorio privado de comprobantes. En desarrollo usa `.data/payment-evidence`; en producción debe configurarse explícitamente fuera del almacenamiento temporal.
- `PAYMENT_EVIDENCE_RETENTION_ENABLED`: por defecto `false`; habilitar solo con aprobación legal/contable.

## Endpoints

- `GET /healthz`
- `POST /orders` — creación autenticada e idempotente, invocada desde Gateway.
- `GET /orders/:orderId` — consulta del pedido por su propietario, invocada desde Gateway.
- `POST /orders/:orderId/cancel` — cancelación antes de cargar el comprobante.
- `POST /orders/:orderId/cancellation-request` — solicitud de cancelación posterior al comprobante.
- `POST` / `GET /orders/:orderId/payment-evidence` — carga y lectura privada del comprobante.
- `GET /admin/payments` y `GET /admin/payments/:orderId` — cola y detalle de revisión.
- `GET` / `POST /admin/payments/:orderId/evidence` — descarga y borrado auditado de la copia privada.
- `POST /admin/payments/:orderId/approve` y `/reject` — decisión de pago y comandos durables de inventario.
- `GET /admin/cancellation-requests` y sus rutas `/resolve` y `/refund-handling` — resolución auditada de solicitudes.
- `POST` / `DELETE /admin/payment-evidence/:orderId/legal-hold` — administración de retención legal.

Las rutas de Orders, incluida `POST /orders`, requieren `GatewayInternalGuard` y el token compartido `ORDERS_INTERNAL_TOKEN`; Gateway envía además los claims de cliente y rol que verificó con Identity. Orders ignora cualquier `customerId` del body y usa el encabezado autenticado. No se deben exponer estos endpoints directamente a clientes.

## Reglas de negocio

- Un pedido debe tener al menos una línea activa.
- Cada línea debe tener cantidad positiva.
- El subtotal se calcula como suma de `unitPriceCop * quantity`; el envío y el total se calculan en servidor.
- La identidad de pedido es estable por `orderId`.
- Los datos de entrada se validan con Zod y el servicio no acepta payloads vacíos ni inválidos.
- `POST /orders` requiere `Idempotency-Key` UUID; errores de validación son `400`, reuso incompatible de clave `409` y fallos de persistencia conservan el código `500`.
- Cada línea se valida contra el catálogo activo; los datos canónicos del producto no se confían al navegador.
- La creación persiste el pedido, `OrderCreated.v1` y el comando durable de reserva en una transacción. Catálogo confirma o rechaza la reserva atómica mediante un worker idempotente; un pedido no se presenta como listo para pagar hasta que la reserva se confirma.
- Si el catálogo no está disponible, la intención queda en el outbox para reintento; un rechazo permanente de inventario produce `RESERVATION_FAILED`.
- Si el comando `RESERVE` llega a su fecha límite antes de poder ejecutarse, se marca terminal y el pedido pasa a `RESERVATION_EXPIRED` en vez de quedar en `RESERVING_INVENTORY`.
- La tarifa es gratuita desde COP 150.000; por debajo de ese umbral es el mayor valor entre COP 12.000 y el 8 % del subtotal.
- `POST /orders` requiere un encabezado `Idempotency-Key` UUID. Repetir clave y contenido devuelve el pedido original; repetir la clave con contenido distinto produce `409 Conflict`.
- Persistencia, evento y comando de reserva se confirman o revierten juntos. La entrega de eventos se considera al menos una vez y el consumidor deduplica por `eventId`.
- Las reclamaciones del outbox vencen y se recuperan; los errores transitorios se reintentan y los elementos agotados requieren conciliación operativa.
- La reserva de Catálogo mantiene separadas las unidades físicas y las reservadas: al aprobar un pago se comprometen juntas una sola vez; al cancelar, vencer o rechazar el pedido se libera la reserva mediante un comando idempotente.

Los comprobantes PDF, JPEG y PNG se guardan en almacenamiento privado local con claves opacas; el límite es 10 MiB. En producción `PAYMENT_EVIDENCE_LOCAL_DIR` debe apuntar a un volumen privado, persistente y fuera de temporales. La retención automática está deshabilitada por defecto. El borrado manual de la copia del servidor requiere confirmación, conserva los metadatos de revisión y no impide aprobar o rechazar el pago usando la copia que guardó la administradora.

## Seguridad

- CORS restringido por origen configurado.
- Helmet con cabeceras de seguridad HTTP.
- Rate limiting por IP para reducir abuso y DoS.
- No se exponen secretos; la conexión a la base de datos se inyecta por variables de entorno.
