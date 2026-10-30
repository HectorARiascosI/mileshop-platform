# Notification Worker

Servicio independiente que recibe `OrderCreated.v1`, registra entregas en su PostgreSQL y deduplica por `eventId`. El adaptador externo de notificación todavía no está implementado; por ahora, el worker registra el evento de forma estructurada.

## Entrega y recuperación

- Una reclamación `PROCESSING` tiene un lease de 30 segundos y un token exclusivo.
- Un evento ya enviado responde como duplicado; una entrega aún activa responde `202 Accepted` para que el productor la reintente después.
- Las reclamaciones vencidas y fallidas se pueden volver a procesar; solo el token vigente puede confirmar o fallar una entrega.
- La entrega entre servicios es al menos una vez. Cualquier futuro proveedor externo debe aceptar `eventId` como clave idempotente para cubrir fallos después de enviar y antes de persistir `SENT`.

Antes de activar tráfico productivo debe completar:

- adaptador externo de notificación;
- pruebas de contrato e integracion;
- logs estructurados, metricas y rollback.
