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
- `CATALOG_SERVICE_URL` configura la dependencia interna.
- El cliente aplica timeout de 3 segundos.
- Fallos de red o respuestas no exitosas se traducen a `503 Service Unavailable`.
- El gateway no posee tablas ni reglas de inventario.

Nest debe recibir el adaptador HTTP mediante el token `CATALOG_FETCH`, de modo que el runtime y las pruebas usen la misma frontera sustituible.

## Verificacion

La responsabilidad se prueba en `services/api-gateway/test/catalog.client.test.ts` con respuestas exitosas y fallos upstream. El arranque real se valida con `catalog-service` levantado y el endpoint publico sirviendo productos.

## Rollback

Si el gateway falla, se revierte el commit de gateway o se restaura la ruta publica anterior. No se modifica la base del catalogo durante un rollback del gateway.

## Consecuencias

La web obtiene una frontera estable, pero cada nuevo dominio requiere una ruta y un cliente explicitamente versionados. La observabilidad futura debe incluir latencia, tasa de errores y disponibilidad por dependencia.
