# Notification Worker

Servicio independiente que recibe `OrderCreated.v1`, registra entregas en su PostgreSQL y deduplica por `eventId`. Admite un destino HTTP genérico cuando se configura el modo `webhook`; no integra aún un proveedor real de WhatsApp o correo.

## Configuración de entrega

- `NOTIFICATION_SENDER_MODE=webhook` requiere `NOTIFICATION_WEBHOOK_URL`; `NOTIFICATION_WEBHOOK_SECRET` es opcional y se envía en `x-notification-secret`.
- `NOTIFICATION_SENDER_MODE=log` registra el evento y lo marca como procesado. El stack local lo selecciona explícitamente para que el smoke test no dependa de un proveedor externo; no debe usarse como entrega productiva.
- El modo por defecto es `webhook`. Si falta su URL o el modo no es reconocido, el worker falla al iniciar en vez de aceptar eventos que no puede entregar.

Antes de activar tráfico productivo debe completar:

- broker o transporte asíncrono definido y health check;
- adaptador de proveedor de notificación;
- pruebas de contrato e integracion;
- logs estructurados, metricas y rollback.
