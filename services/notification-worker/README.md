# Notification Worker

Servicio independiente que recibe `OrderCreated.v1`, registra entregas en su PostgreSQL y deduplica por `eventId`. El adaptador externo de notificación todavía no está implementado.

Antes de activar tráfico productivo debe completar:

- broker o transporte asíncrono definido y health check;
- outbox transaccional del productor;
- adaptador externo de notificación;
- pruebas de contrato e integracion;
- logs estructurados, metricas y rollback.
