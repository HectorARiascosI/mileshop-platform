# Notification Worker

Servicio independiente planificado para consumir `OrderCreated.v1`, deduplicar entregas y enviar notificaciones por los adaptadores configurados.

Antes de activar trafico productivo debe tener:

- broker definido y health check;
- persistencia propia de entregas y reintentos;
- outbox del productor;
- deduplicacion por `eventId`;
- pruebas de contrato e integracion;
- logs estructurados, metricas y rollback.
