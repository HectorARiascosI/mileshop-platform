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

## Migraciones

Las migraciones se aplican exclusivamente a la base del servicio de catálogo con `npm run db:deploy --workspace @mileshop/catalog-service` y su propia `DATABASE_URL`. El build de Vercel solo genera Prisma Client; no aplica migraciones. La migración `20261103090000_product_categories` agrega categorías y una relación opcional, de modo que los productos existentes permanecen sin categoría. La migración `20261103100000_product_image_gallery` agrega la galería ordenada y copia cada imagen principal actual a la primera posición; conserva las columnas principales para compatibilidad. La migración `20261103110000_catalog_marketing` agrega campañas de descuentos por producto y anuncios independientes. Las tres migraciones son aditivas. Antes de desplegar código que dependa de estas migraciones, aplícalas y verifícalas en el entorno objetivo; nunca uses la conexión de otro servicio ni ejecutes la migración de Preview contra Production.

Variables:

- `DATABASE_URL`: conexion exclusiva de la base de datos del catalogo.
- `CATALOG_INVENTORY_COMMAND_TOKEN`: secreto compartido con API Gateway y Orders para comandos internos; usa al menos 32 caracteres en producción.
- `PORT`: puerto HTTP, por defecto `3020`.

Endpoints:

- `GET /healthz`
- `GET /products`
- `GET /announcements` devuelve únicamente anuncios activos dentro de su vigencia. Los productos incluyen el precio promocional calculado y, si aplica, el precio anterior y la campaña.
- `GET /internal/admin/products` lista productos activos e inactivos para administración.
- `POST /internal/admin/products` y `PATCH /internal/admin/products/:productId` crean y actualizan productos. El stock inicial es cero; usa una recepción para aumentarlo.
- `GET`, `POST`, `PATCH` y `DELETE /internal/admin/promotions` (con `:promotionId` para editar o retirar) administran campañas; cada producto tiene un descuento entero del 1 % al 90 % y no se permiten campañas activas con vigencias superpuestas sobre el mismo producto.
- `GET`, `POST`, `PATCH` y `DELETE /internal/admin/announcements` (con `:announcementId` para editar o retirar) administran avisos separados de las promociones. Los enlaces son opcionales, pero deben ser HTTPS.
- `POST /internal/admin/stock-receipts` registra una entrada auditable e idempotente; requiere `Idempotency-Key`.
- `POST /internal/admin/manual-sales` registra una venta de tienda con `Idempotency-Key`; el API Gateway valida el rol de administradora antes de invocarla. El registro y el descuento de inventario se confirman juntos.

Todos los endpoints `internal/admin` requieren autenticación de servicio con `CATALOG_INVENTORY_COMMAND_TOKEN`. La interfaz administrativa está en `/admin/catalog`; los productos se desactivan en vez de eliminarse para preservar pedidos y movimientos históricos. Cada producto admite hasta ocho fotos ordenables, importadas desde el dispositivo o vinculadas por URL HTTPS. La primera foto también se mantiene en los campos de imagen existentes y es la que usa la portada de la tienda.

La gestión de descuentos está separada en `/admin/catalog/promotions` y los anuncios en `/admin/catalog/announcements`. Catálogo aplica una única campaña activa por producto y persiste el precio efectivo en la reserva; Orders actualiza el precio unitario, subtotal, tarifa de entrega, total y evento usando exactamente ese snapshot. Los pedidos ya creados conservan su importe aunque la campaña cambie después. No despliegues la aplicación que usa estas entidades antes de aplicar la migración `20261103110000_catalog_marketing` al entorno apropiado.
