# Despliegue MileShop: Vercel + Neon

## Arquitectura

- **Seis proyectos Vercel:** `apps/web` y los cinco servicios bajo `services/`.
- **Cuatro bases PostgreSQL en Neon:** `catalog`, `identity`, `notifications` y `orders`, una por servicio propietario de datos.
- El catálogo guarda fotos en ImageKit. El servicio web necesita `IMAGEKIT_PRIVATE_KEY` como variable secreta en cada entorno donde se administren imágenes.
- Cada servicio NestJS se ejecuta como una función Vercel mediante el adaptador Fastify compartido; no requiere procesos residentes.
- La reserva de inventario se ejecuta en el flujo de creación del pedido por una ventana de pago de dos horas. En Vercel no se usan timers ni Cron Jobs de Vercel; un scheduler externo gratuito llama el mantenimiento de Orders cada minuto para recuperar trabajo pendiente y liberar reservas vencidas.
- El pago es manual y fuera de la plataforma: el cliente continúa por WhatsApp Business y la administradora valida el pago. No hay pasarela de pago.
- `notification-worker` queda en modo `log`; el enlace de WhatsApp se inicia desde el storefront. El worker no envía mensajes externos en esta configuración.

Esta configuración no crea cuentas, bases, dominios ni variables por ti. Los niveles gratuitos tienen cuotas, límites y políticas que pueden cambiar; no se garantiza un costo de cero ni disponibilidad continua. Revisa los límites vigentes de [Vercel Functions](https://vercel.com/docs/functions/limitations) y [Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing), y de [Neon](https://neon.tech/pricing).

## Almacenamiento de imágenes del catálogo

La aplicación usa ImageKit para alojar fotos públicas del catálogo y eliminarlas mediante su API cuando dejan de estar asociadas a un producto. Crea una cuenta, obtén una clave privada desde el panel y configura `IMAGEKIT_PRIVATE_KEY` en el proyecto Vercel de `apps/web` para Preview y Production. La clave solo se usa en rutas de servidor y no debe tener el prefijo `NEXT_PUBLIC_`. El plan gratuito publicado actualmente incluye 3 GB de almacenamiento y 20 GB de transferencia mensual; comprueba el panel y los límites vigentes antes de habilitar cargas. Las cargas desde el dispositivo están limitadas a 4 MB para ajustarse al tamaño máximo de solicitud del servidor web. No se requiere un dominio propio para servir los archivos.

Para una instalación local, copia la variable vacía de `apps/web/.env.example` a `apps/web/.env.local` y define ahí la clave privada. No guardes la clave en Git, tickets ni mensajes.

## 1. Crear las bases en Neon

1. Crea un proyecto Neon PostgreSQL y cuatro bases separadas: `catalog`, `identity`, `notifications` y `orders`. Usa un rol propietario distinto por base: `catalog_app`, `identity_app`, `notifications_app` y `orders_app`.
2. Para cada base, guarda dos conexiones:
   - **Runtime:** URL pooled que Neon entrega (`-pooler` en el hostname), con TLS. El código usa `@prisma/adapter-neon` y limita el pool local a una conexión por instancia.
   - **Migraciones/administración:** URL directa, no pooled. Úsala solo desde un entorno confiable para migrar o sembrar datos.
3. No compartas la misma URL/base entre servicios. No incluyas credenciales en el repositorio ni en mensajes.
4. Crea los roles de aplicación desde el SQL Editor (no con **Add role**): los roles creados desde la consola heredan `neon_superuser`. Con el rol inicial del proyecto, ejecuta:

   ```sql
   CREATE ROLE catalog_app LOGIN;
   GRANT catalog_app TO catalog_owner;
   ALTER DATABASE catalog OWNER TO catalog_app;
   CREATE ROLE identity_app LOGIN;
   CREATE ROLE orders_app LOGIN;
   CREATE ROLE notifications_app LOGIN;
   ```

   Al agregar las otras tres bases, asigna como propietario `identity_app`, `orders_app` y `notifications_app`, respectivamente. Los roles creados mediante SQL no tienen contraseña inicial y **Roles → Reset password** no funciona para ellos. Define cada contraseña desde el SQL Editor con `ALTER ROLE catalog_app WITH PASSWORD '<contraseña-generada-en-tu-gestor-seguro>';` (repite para los otros tres roles). Reemplaza el marcador directamente en Neon, nunca en el repositorio ni en el chat. Los roles SQL no heredan `neon_superuser`; cada servicio queda propietario únicamente de su base.

El esquema Prisma de esta versión conserva Prisma 6.12.0 y activa `driverAdapters` en preview con el adaptador oficial `@prisma/adapter-neon@6.12.0` en runtime Vercel. Localmente, donde `VERCEL` no está definido, Prisma usa el cliente PostgreSQL estándar. La actualización a una versión estable más reciente de Prisma queda pendiente de resolver sus avisos transitivos antes de publicarla. Consulta la [guía de Prisma 6 para Neon](https://www.prisma.io/docs/orm/v6/overview/databases/neon).

## 2. Crear los seis proyectos Vercel

Importa `mileshop-platform` seis veces como proyectos separados y configura el **Root Directory** indicado. Habilita **Include source files outside of the Root Directory in the Build Step** para que cada proyecto pueda resolver el lockfile, los workspaces y los paquetes compartidos desde la raíz.
Configura **Node.js Version 24.x** en los seis proyectos; el adaptador Neon usa el WebSocket global de Node en el runtime serverless.

| Proyecto Vercel | Root Directory | Configuración de build |
|---|---|---|
| Storefront | `apps/web` | Next.js |
| API Gateway | `services/api-gateway` | Framework `Other`; `vercel.json` |
| Catálogo | `services/catalog-service` | Framework `Other`; `vercel.json` |
| Identidad | `services/identity-service` | Framework `Other`; `vercel.json` |
| Pedidos | `services/orders-service` | Framework `Other`; `vercel.json` |
| Notificaciones | `services/notification-worker` | Framework `Other`; `vercel.json` |

Para los servicios backend, usa el preset `Other`, no NestJS: NestJS puede tratar `src/app.ts` como función y fallar al invocarla. Cada `vercel.json` define `outputDirectory: dist`, el comando de build y la función `api/[...path].ts`; el handler publica las rutas bajo `/api`. Conserva el comando de instalación detectado para el workspace raíz (`npm install`/`npm ci` según la configuración del proyecto). Los despliegues no ejecutan migraciones automáticamente.

El override raíz fija `light-my-request` en `6.6.0`: `6.8.0` intenta cargar `cookie` 2.x (ESM) desde CommonJS y provoca `ERR_REQUIRE_ESM` en las funciones de Vercel. Antes de retirar el override, valida `/api/healthz` en un Preview.

Cada URL de servicio usada por otro proyecto debe incluir el prefijo `/api`, por ejemplo `https://catalogo.example/api`. El adaptador quita ese prefijo antes de entregar la solicitud a Fastify.

## 3. Variables de entorno

Configúralas por proyecto y por entorno (`Production`, `Preview` y `Development`). No reutilices secretos de producción en Preview.

| Proyecto | Variables |
|---|---|
| Storefront | `API_GATEWAY_URL` (URL HTTPS del Gateway terminada en `/api`), `VERCEL_GATEWAY_BYPASS_SECRET` (solo Preview; bypass del proyecto Gateway), `IMAGEKIT_PRIVATE_KEY` (clave privada de ImageKit para administrar fotos), `NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE` (número Business internacional, sin `+`, espacios ni guiones). |
| API Gateway | `CATALOG_SERVICE_URL`, `IDENTITY_SERVICE_URL`, `ORDERS_SERVICE_URL` (cada una HTTPS y terminada en `/api`), `VERCEL_CATALOG_BYPASS_SECRET`, `VERCEL_IDENTITY_BYPASS_SECRET`, `VERCEL_ORDERS_BYPASS_SECRET` (solo Preview; bypass del proyecto de destino), `ORDERS_INTERNAL_TOKEN`, `CATALOG_INVENTORY_COMMAND_TOKEN`, `ALLOWED_ORIGINS` (origen HTTPS del storefront). |
| Catálogo | `DATABASE_URL` (URL pooled de la base `catalog`), `CATALOG_RESERVATION_TOKEN`, `CATALOG_INVENTORY_COMMAND_TOKEN`. |
| Identidad | `DATABASE_URL` (URL pooled de `identity`), `JWT_SECRET`, `ALLOWED_ORIGINS` (origen HTTPS del storefront). |
| Pedidos | `DATABASE_URL` (URL pooled de `orders`), `CATALOG_SERVICE_URL`, `NOTIFICATION_WORKER_URL` (URLs HTTPS terminadas en `/api`), `VERCEL_CATALOG_BYPASS_SECRET`, `VERCEL_NOTIFICATIONS_BYPASS_SECRET` (solo Preview; bypass del proyecto de destino), `CATALOG_RESERVATION_TOKEN`, `CATALOG_INVENTORY_COMMAND_TOKEN`, `ORDERS_INTERNAL_TOKEN`, `CRON_SECRET`, `ALLOWED_ORIGINS` (origen HTTPS del storefront). |
| Notificaciones | `DATABASE_URL` (URL pooled de `notifications`), `NOTIFICATION_SENDER_MODE=log`. |

Los Preview de Vercel están protegidos por Vercel Authentication. Para habilitar llamadas entre proyectos, crea un secreto de **Protection Bypass for Automation** distinto en cada proyecto de destino y copia cada valor únicamente a la variable correspondiente del proyecto llamador. Usa el scope Preview del branch `chore/vercel-vps-deployment`; no habilites el secreto como variable de sistema ni lo agregues a Production. Gateway, Orders y Storefront solo envían el header de bypass cuando `VERCEL_ENV=preview` y el destino usa HTTPS bajo el dominio de proyectos del equipo `hector-riascos-projects.vercel.app`.

Los valores de `ORDERS_INTERNAL_TOKEN` deben coincidir entre Gateway y Orders. `CATALOG_INVENTORY_COMMAND_TOKEN` debe coincidir entre Gateway, Orders y Catálogo; `CATALOG_RESERVATION_TOKEN` debe coincidir entre Orders y Catálogo. Genera secretos independientes y aleatorios de al menos 32 caracteres; por ejemplo, localmente con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`. No uses el mismo secreto para propósitos distintos.

Los servicios fallan al inicializar en producción cuando faltan las variables marcadas como requeridas por su `app.ts`, en vez de iniciar con URLs locales. El endpoint de mantenimiento autentica mediante `Authorization: Bearer <CRON_SECRET>` enviado por el scheduler externo; Vercel no programa esta tarea.

### Scheduler externo gratuito para Orders

Se usa [cron-job.org](https://cron-job.org/en/) como disparador externo; la aplicación y sus funciones continúan ejecutándose en Vercel. Según la [página oficial](https://cron-job.org/en/) y sus [FAQ](https://cron-job.org/en/faq/), ofrece ejecución hasta una vez por minuto, método HTTP y headers personalizados sin costo. La cuenta externa almacena el secreto de autorización; protégela con contraseña única y MFA.

1. En Vercel, configura `CRON_SECRET` únicamente en **Production** para el proyecto Orders. Usa un secreto aleatorio propio de al menos 32 caracteres; no lo incluyas en Git, URL, capturas ni mensajes. Si ya existe, conserva ese valor y no lo rotes sin actualizar también el scheduler.
2. Crea un trabajo en cron-job.org con método `POST`, URL `https://<dominio-orders>/api/internal/maintenance` y frecuencia **cada minuto**.
3. En los headers personalizados del trabajo, añade `Authorization` con valor `Bearer <el mismo CRON_SECRET>`. Nunca pongas el token en la URL o el cuerpo.
4. Ejecuta el test del trabajo y confirma HTTP `200`; revisa los logs de la función Orders en Vercel y activa avisos de fallo en cron-job.org. La respuesta solo se considera exitosa cuando Orders termina el mantenimiento.
5. El endpoint procesa hasta 25 reservas vencidas por ejecución; si hay más, las siguientes llamadas continúan los lotes. La liberación queda registrada como comando durable e idempotente.

El proveedor limita cada solicitud a 30 segundos, no garantiza puntualidad exacta y puede desactivar un trabajo tras fallos repetidos. Vercel Orders también tiene `maxDuration: 30`. El intervalo de un minuto reduce el retraso esperado, pero no ofrece SLA ni garantiza costo/disponibilidad permanente; vigila las notificaciones y el historial de ejecuciones. No configures además un segundo scheduler para el mismo endpoint salvo durante una prueba controlada.

Con el límite publicado de Hobby de un millón de invocaciones mensuales, un trabajo por minuto representa aproximadamente 43.200 invocaciones al mes si se ejecuta sin interrupciones, antes de contar el tráfico normal. Vercel también limita Hobby a cuatro horas de CPU activa mensuales; la función pasa la mayor parte del tiempo esperando a Neon/red, pero mide el uso real en Usage y configura alertas. Las cuotas y precios pueden cambiar.

## 4. Aplicar migraciones y preparar datos

Hazlo desde la raíz del repositorio, desde una máquina confiable con Node.js/npm y acceso a Neon. Usa la URL directa correspondiente para cada comando; no coloques URLs reales en documentación ni archivos rastreados:

Las migraciones `20261102090000_product_imagekit_asset`, `20261103100000_product_image_gallery` y `20261103110000_catalog_marketing` añaden la gestión de assets de imagen, galerías, promociones y anuncios en `catalog`. La migración `20261103120000_payment_reported_reservation_hold` añade la marca auditable de pago reportado en `orders`. Aplica cada migración a su base antes de desplegar los servicios que la utilizan.

```powershell
$env:DATABASE_URL = "<URL directa de catalog>"
npm run db:deploy --workspace @mileshop/catalog-service

$env:DATABASE_URL = "<URL directa de identity>"
npm run db:deploy --workspace @mileshop/identity-service

$env:DATABASE_URL = "<URL directa de notifications>"
npm run db:deploy --workspace @mileshop/notification-worker

$env:DATABASE_URL = "<URL directa de orders>"
npm run db:deploy --workspace @mileshop/orders-service

Remove-Item Env:DATABASE_URL
```

Para conceder el rol de tienda a la cuenta propietaria:

1. Despliega Gateway e Identidad, registra la cuenta de la administradora y confirma que puede iniciar sesión.
2. Con la URL directa de `identity` en `DATABASE_URL`, ejecuta:

```powershell
npm run admin:bootstrap --workspace @mileshop/identity-service -- correo-de-la-administradora@example.com
```

El bootstrap es de una sola vez y solo puede conceder el primer rol `STORE_ADMIN`. Protege la terminal y la URL directa mientras ejecutas estos comandos.

**No ejecutes `npm run db:seed:catalog` en producción:** el seed actual contiene productos de ejemplo y desactiva los SKU que no estén en esa lista. Debe reemplazarse con el inventario real de MileShop antes de publicar el catálogo.

## 5. Orden de despliegue y smoke test

1. Ejecuta las migraciones antes de publicar servicios que dependan de esas tablas. No ejecutes el seed de demostración en producción; si necesitas datos de prueba, usa una base y un entorno separados.
2. Despliega Notificaciones, Catálogo e Identidad.
3. Despliega Pedidos y luego API Gateway; configura sus URLs públicas entre sí.
4. Despliega Storefront y configura su `API_GATEWAY_URL` con la URL del Gateway.
5. Comprueba `https://<dominio-del-proyecto>/api/healthz` en cada servicio y `https://<dominio-del-gateway>/api/catalog/products`.
6. Desde el dominio real del storefront, registra e inicia sesión, consulta el catálogo, crea un pedido, verifica que se reserve el inventario y comprueba que el cliente llegue al WhatsApp Business correcto.
7. No abras la tienda a clientes hasta que la administradora pueda revisar pedidos de WhatsApp, confirmarlos/cancelarlos y registrar ventas manuales desde una interfaz probada.

Después de desplegar Orders, revisa los pedidos pendientes heredados sin fecha de expiración antes de activar el scheduler: no se expiran automáticamente por esta implementación y no deben liberarse sin comprobar que no haya acuerdos de pago en WhatsApp. Para pedidos nuevos, si el cliente informa que pagó antes del vencimiento, la administradora debe usar **Marcar pago informado** en `/admin/orders`; la marca queda auditada con actor y fecha y la exclusión de expiración se aplica transaccionalmente. La reserva se conserva hasta que el pago se confirme o el pedido se cancele. Revisa diariamente las marcas pendientes; el panel las señala cuando superan 24 horas. Luego configura y prueba el scheduler externo descrito arriba; sin él, la expiración automática y la recuperación periódica no ocurren en Vercel. Comprueba en cron-job.org que el `POST /api/internal/maintenance` responde `200` cada minuto y revisa los logs de Orders. El endpoint recupera intents, outbox y comandos pendientes, además de expirar reservas.

## Límites actuales que no se deben ocultar

- En producción, el módulo de comprobantes solo se registra si se configura `PAYMENT_EVIDENCE_STORAGE`. Sin esa variable, las rutas responden `503` explícitamente; en Vercel no configures el adaptador `local`, porque su filesystem no es persistente. El flujo acordado es WhatsApp Business, no la carga de archivos a la web.
- La pantalla `/admin/orders` permite revisar pedidos recibidos por WhatsApp, confirmar pagos verificados, cancelar pedidos y registrar ventas manuales por producto/cantidad. `/admin/payments` sigue siendo el flujo antiguo de comprobantes subidos y no es necesario para la operación WhatsApp.
- El enlace WhatsApp no equivale a una confirmación de pago. La administradora debe verificar la transferencia y luego confirmar o cancelar el pedido.
- La administración de productos y entradas de inventario está disponible en `/admin/catalog`; `/admin/orders` permite revisar pedidos de WhatsApp, confirmarlos/cancelarlos y registrar ventas presenciales. Antes de abrir la tienda, carga el catálogo real desde el panel y verifica las operaciones con la cuenta `STORE_ADMIN`.
- Las funciones serverless no mantienen timers entre solicitudes. La recuperación periódica depende del scheduler externo y puede retrasarse o detenerse si el proveedor gratuito falla o desactiva el trabajo; revisa sus alertas e historial.
- Vercel Functions no ofrece almacenamiento persistente local. No guardes comprobantes, sesiones ni estado durable en el filesystem de una función.
