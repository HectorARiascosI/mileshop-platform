# Catalog Service

Servicio propietario del catalogo y de su base de datos PostgreSQL. Ningun otro servicio accede directamente a sus tablas.

## Desarrollo local

Desde la raiz del repositorio, con `catalog-postgres` levantado:

```powershell
$env:DATABASE_URL = "postgresql://catalog:catalog@localhost:5434/catalog?schema=public"
npm run db:deploy --workspace @mileshop/catalog-service
npm run db:seed --workspace @mileshop/catalog-service
npm run start:dev --workspace @mileshop/catalog-service
```

El seed es idempotente: usa `sku` como identidad natural y se puede ejecutar varias veces sin duplicar productos.

Variables:

- `DATABASE_URL`: conexion exclusiva de la base de datos del catalogo.
- `PORT`: puerto HTTP, por defecto `3020`.

Endpoints:

- `GET /healthz`
- `GET /products`
