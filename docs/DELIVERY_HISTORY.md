# Historial de entregas

Este documento resume el orden de trabajo de la plataforma nueva. Cada bloque se entrega en una rama corta y con commits Conventional Commits separados por responsabilidad.

## Base

- `654b5c8 chore(repo): initialize distributed platform governance`
- Rama: `main`
- Resultado: monorepo, gobernanza, CI, Compose y contratos iniciales.

## Gateway

- `c040254 feat(gateway): expose catalog products through public API`
- `9847ceb fix(gateway): register fetch adapter with Nest`
- Ramas: `feat/api-gateway-catalog` y sus ramas dependientes.
- Resultado: healthcheck, composicion del catalogo, timeout, errores `503` y pruebas.

## Storefront

- `42dc65d feat(web): add catalog storefront shell`
- `9bcf6a4 docs(web): document storefront runtime behavior`
- Rama: `feat/web-catalog`.
- Resultado: portada MileShop, estados de carga funcionales y responsive.

## Persistencia del catalogo

- `529e399 feat(catalog): add idempotent development seed`
- Rama: `feat/catalog-development-data`.
- Resultado: seed por `sku`, comandos Prisma, documentacion operativa y validacion end-to-end.

## Regla de integracion

Las ramas dependientes se fusionan en orden: gateway, storefront y datos del catalogo. Cada PR debe conservar su objetivo, pruebas, riesgos, rollback y evidencia de CI. `main` no recibe cambios directos.
