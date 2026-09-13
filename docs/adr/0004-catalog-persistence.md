# ADR 0004: Persistencia y datos iniciales del catalogo

- Estado: aceptado
- Fecha: 2026-09-13
- Alcance: `services/catalog-service`

## Contexto

El catalogo necesita ownership claro de sus datos y una forma reproducible de poblar un entorno local. Los datos de desarrollo no deben vivir en el frontend ni depender de inserciones manuales.

## Decision

`catalog-service` es propietario de su PostgreSQL y de sus migraciones Prisma:

- La conexion se recibe mediante `DATABASE_URL`.
- Las migraciones se aplican con `db:deploy`.
- Los datos de demostracion se cargan con `db:seed`.
- `sku` es la identidad natural del seed.
- El seed usa `upsert`, por lo que es idempotente.
- Los productos inactivos no se exponen en `/products`.
- Ningun servicio externo consulta las tablas del catalogo directamente.

El seed actual contiene tres productos de desarrollo y no representa datos de produccion.

## Operacion local

```powershell
$env:DATABASE_URL = "postgresql://catalog:catalog@localhost:5434/catalog?schema=public"
docker compose -f infra/docker-compose.yml up -d --wait catalog-postgres
npm run db:deploy --workspace @mileshop/catalog-service
npm run db:seed --workspace @mileshop/catalog-service
```

## Verificacion

La migracion se aplica sobre una base vacia y el seed se ejecuta dos veces sin duplicados. El servicio se comprueba mediante `GET /healthz` y `GET /products`.

## Rollback

Las migraciones nuevas deben tener una estrategia compatible y reversible. Un rollback de datos requiere backup de la base de catalogo; nunca se resuelve borrando tablas desde otro servicio.
