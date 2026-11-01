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

El seed es idempotente: usa `sku` como identidad natural, reactiva los productos declarados y desactiva los SKUs retirados sin duplicar productos.
Los productos incluidos son datos de desarrollo. No ejecutes el seed en producción: reemplaza el catálogo con el inventario real antes de publicar la tienda.

Variables:

- `DATABASE_URL`: conexion exclusiva de la base de datos del catalogo.
- `CATALOG_INVENTORY_COMMAND_TOKEN`: secreto compartido con API Gateway y Orders para comandos internos; usa al menos 32 caracteres en producción.
- `PORT`: puerto HTTP, por defecto `3020`.

Endpoints:

- `GET /healthz`
- `GET /products`
- `GET /internal/admin/products` lista productos activos e inactivos para administración.
- `POST /internal/admin/products` y `PATCH /internal/admin/products/:productId` crean y actualizan productos. El stock inicial es cero; usa una recepción para aumentarlo.
- `POST /internal/admin/stock-receipts` registra una entrada auditable e idempotente; requiere `Idempotency-Key`.
- `POST /internal/admin/manual-sales` registra una venta de tienda con `Idempotency-Key`; el API Gateway valida el rol de administradora antes de invocarla. El registro y el descuento de inventario se confirman juntos.

Todos los endpoints `internal/admin` requieren autenticación de servicio con `CATALOG_INVENTORY_COMMAND_TOKEN`. La interfaz administrativa está en `/admin/catalog`; los productos se desactivan en vez de eliminarse para preservar pedidos y movimientos históricos.
