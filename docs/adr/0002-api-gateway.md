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
- `POST /orders` exige una sesión JWT y `Idempotency-Key`; el gateway verifica el token y delega la creación en `orders-service`.
- `GET /orders/:orderId` exige una sesión JWT y retorna únicamente pedidos cuyo `customerId` coincide con la identidad verificada.
- `orders-service` es propietario del cálculo de subtotal, envío y total, del estado inicial `PENDING` y de la outbox persistente que publica `OrderCreated.v1` hacia `notification-worker`.
- `CATALOG_SERVICE_URL` configura la dependencia interna.
- `ORDERS_SERVICE_URL` y `IDENTITY_SERVICE_URL` configuran las dependencias del gateway; `NOTIFICATION_WORKER_URL` pertenece a `orders-service`.
- El cliente aplica timeout de 3 segundos.
- Fallos de red o respuestas no exitosas se traducen a `503 Service Unavailable`.
- El gateway no posee tablas ni reglas de inventario.

Nest debe recibir el adaptador HTTP mediante el token `CATALOG_FETCH`, de modo que el runtime y las pruebas usen la misma frontera sustituible.

## Verificacion

La composición y sus fallos upstream se prueban en `services/api-gateway/test/catalog.client.test.ts` y `orders.service.test.ts`; la autenticación se prueba en `auth.middleware.test.ts`. El cálculo de importes, la idempotencia y los reintentos de outbox se prueban en `services/orders-service/test/orders.service.test.ts`. El flujo integrado se verifica con `npm run verify:local-purchase`.

## Rollback

Si el gateway falla, se revierte el commit de gateway o se restaura la ruta publica anterior. No se modifica la base del catalogo durante un rollback del gateway.

## Consecuencias

La web obtiene una frontera estable, pero cada nuevo dominio requiere una ruta y un cliente explicitamente versionados. El gateway es la frontera de autenticación y propiedad del pedido; la idempotencia y las reglas monetarias pertenecen a `orders-service`. El pedido, sus líneas y el evento de outbox se guardan en una única transacción; la publicación HTTP ocurre después del commit y los fallos se reintentan desde la outbox. La observabilidad futura debe incluir latencia, tasa de errores y disponibilidad por dependencia.
