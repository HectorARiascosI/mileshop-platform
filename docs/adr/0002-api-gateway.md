# ADR 0002: API Gateway como entrada publica

- Estado: aceptado
- Fecha: 2026-09-13
- Alcance: `services/api-gateway`

## Contexto

El navegador no debe conocer topologia interna, puertos ni contratos privados de cada servicio. El primer flujo publico necesita consultar el catalogo sin crear acoplamiento directo entre la web y PostgreSQL.

## Decision

El API Gateway expone una superficie HTTP publica y compone respuestas de servicios internos:

- `GET /healthz` valida disponibilidad del gateway.
- `GET /catalog/products` consulta `catalog-service`.
- `POST /orders` valida la identidad y reenvía la solicitud a `orders-service`; este servicio persiste el pedido y `OrderCreated.v1` en una transacción y administra la entrega a `notification-worker` mediante outbox.
- `CATALOG_SERVICE_URL` configura la dependencia interna.
- `ORDERS_SERVICE_URL` configura la dependencia de pedidos.
- El encabezado `Idempotency-Key` identifica reintentos del mismo checkout.
- El cliente aplica timeout de 3 segundos.
- Errores de validación son `400`, conflictos de idempotencia `409` y fallos de dependencias `503 Service Unavailable`.
- El gateway no posee tablas ni reglas de inventario.

Nest debe recibir el adaptador HTTP mediante el token `CATALOG_FETCH`, de modo que el runtime y las pruebas usen la misma frontera sustituible.

## Verificacion

La responsabilidad se prueba en `services/api-gateway/test/catalog.client.test.ts` con respuestas exitosas y fallos upstream. El arranque real se valida con `catalog-service` levantado y el endpoint publico sirviendo productos.

## Rollback

Si el gateway falla, se revierte el commit de gateway o se restaura la ruta publica anterior. No se modifica la base del catalogo durante un rollback del gateway.

## Consecuencias

La web obtiene una frontera estable, pero cada nuevo dominio requiere una ruta y un cliente explicitamente versionados. La observabilidad futura debe incluir latencia, tasa de errores y disponibilidad por dependencia.
