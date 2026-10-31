# Contribuir a MileShop Platform

## 1. Alcance

Este repositorio contiene la plataforma distribuida de MileShop. El repositorio legacy `Proyecto_ventas` se conserva solo como referencia histórica y como material de migración, pero no debe mezclarse ni dependerse de él como fuente de verdad del sistema actual.

## 2. Modelo de ramas y flujo 2026

Se utiliza un flujo de ramas claro y protegido:

- `main`: rama de producción, protegida, desplegable y estable.
- `develop`: rama de integración para características validadas y listas para release.
- `feature/<dominio>-<descripcion>`: trabajo nuevo, de una intención concreta.
- `fix/<dominio>-<problema>`: corrección de defectos en una funcionalidad existente.
- `hotfix/<dominio>-<problema>`: corrección urgente para producción.
- `release/<version>`: preparación de un release controlado.
- `docs/<tema>`: documentación.
- `chore/<tema>`: herramientas, dependencias, mantenimiento y tareas operativas.

Reglas:

- No se trabaja directamente en `main` ni en `develop`.
- Todo cambio sale desde una rama corta y específica.
- Las PRs se abren hacia `develop` para cambios de funcionalidad.
- `main` solo recibe cambios a través de `release/*` o `hotfix/*`, siempre con revisión y verificación completa.
- Cada rama debe mantener un objetivo único y medible.

## 3. Política de pull requests

Toda PR debe incluir:

- problema central y criterio de aceptación;
- impacto técnico y de negocio;
- servicios, contratos y basados de datos afectados;
- migraciones, backfill, rollback y estrategia de despliegue;
- casos de prueba ejecutados;
- riesgos, observabilidad y rollback planificado;
- evidencia de CI y build.

Criterios de merge:

- CI verde;
- revisión aprobada por otra persona;
- no hay secretos ni archivos locales sensibles;
- no hay cambios mixtos sin relación;
- no se rompe ownership por dominio ni se cruzan responsabilidades entre servicios.

## 4. Commits

Usamos Conventional Commits:

```text
<tipo>(<alcance>): <descripcion imperativa>
```

Tipos permitidos:

- `feat`: nueva funcionalidad
- `fix`: corrección de bug
- `refactor`: reorganización sin cambio funcional
- `test`: pruebas
- `docs`: documentación
- `chore`: mantenimiento y tooling
- `build`: cambios de compilación o empaquetado
- `ci`: integración continua
- `perf`: rendimiento
- `revert`: reversión de un cambio

Ejemplos:

- `feat(catalog): expose active products endpoint`
- `fix(gateway): handle catalog unavailable with timeout fallback`
- `docs(runtime): document local startup and health checks`
- `ci(repo): enforce quality gates on develop and main`

Regla: cada commit debe resolver una única intención, ser compilable y explicar claramente qué problema resuelve.

## 5. Reglas de arquitectura

- Cada servicio posee su propia base de datos y migraciones.
- No se comparten tablas ni modelos entre dominios.
- Los límites entre servicios usan HTTP o eventos versionados.
- Los consumidores de eventos son idempotentes.
- Los adaptadores externos implementan puertos definidos por la aplicación.
- La lógica de negocio vive en capas testeables y no en controladores anémicos.
- SOLID se aplica para reducir acoplamiento, no para crear capas vacías.
- Los secretos deben ir en variables de entorno y nunca en repositorio.

### Comandos internos de inventario

Las rutas `POST /internal/inventory/reservations`, `/commit` y `/release` son para comunicación entre servicios, no para el cliente. Requieren `Authorization: Bearer <token>` y `Idempotency-Key` con el ID del pedido. Configura el mismo secreto fuerte en `CATALOG_INVENTORY_COMMAND_TOKEN` para `catalog-service` y `orders-service`; no hay valor por defecto y no debe guardarse en el repositorio. La reserva valida todas las líneas de forma atómica; las repeticiones con un contenido distinto se rechazan.

Al crear un pedido, `orders-service` guarda en una sola transacción el pedido, `OrderCreated.v1` y el comando durable de reserva. La respuesta inicial expone `status: "RESERVING_INVENTORY"` y `reservationExpiresAt` (seis horas después de su creación). Cuando Catálogo confirma, el estado cambia a `AWAITING_PAYMENT_PROOF`; si Catálogo rechaza permanentemente la reserva, cambia a `RESERVATION_FAILED`. Los errores de infraestructura se reintentan y no se confunden con un rechazo de inventario.

El comprobante solo se acepta si el servidor lo recibe antes de `reservationExpiresAt` (la igualdad cuenta como vencido). La hora de recepción se conserva como `receivedAt`; en una transacción condicionada, el pedido pasa de `AWAITING_PAYMENT_PROOF` a `PAYMENT_REVIEW_PENDING` junto con la persistencia de sus metadatos. Si la reserva venció o la transición perdió una carrera concurrente, el archivo almacenado se elimina y el pedido no se reactiva.

`orders-service` revisa vencimientos al iniciar y cada 30 segundos, en lotes de hasta 25 pedidos. Solo vence pedidos `AWAITING_PAYMENT_PROOF` sin comprobante ni decisión administrativa y con `reservationExpiresAt` alcanzado. El cambio a `RESERVATION_EXPIRED` y el comando idempotente `RELEASE` se guardan en la misma transacción; si compite con una carga de comprobante, solo una transición puede ganar. El worker de inventario intenta liberar de inmediato y conserva reintentos durables si Catálogo no está disponible. El seguimiento del cliente muestra la reserva vencida y deja de consultar pedidos terminales.

El propietario puede cancelar con `POST /api/orders/{orderId}/cancel` mientras el pedido está en `AWAITING_PAYMENT_PROOF`, antes del vencimiento y sin comprobante ni decisión de pago. La gateway verifica identidad y rol; Orders cambia el estado a `CANCELLED` y guarda un único `RELEASE` durable en la misma transacción. Las repeticiones son idempotentes, y el worker de inventario intenta liberar enseguida y reintenta si Catálogo está indisponible. Cuando ya existe un comprobante, la cancelación directa devuelve conflicto y no libera la reserva; la solicitud y resolución posterior pertenecen a T021.

`GET /products` conserva el campo `stock`, que representa unidades disponibles para venta (`stock` físico menos reservas activas), no existencias físicas sin reservar. Al aprobar un pago, el inventario físico y la reserva se reducen juntos; al liberar una reserva, las unidades vuelven a estar disponibles. Esta cifra sirve para mostrar y validar rápidamente el catálogo; la reserva atómica de Catálogo sigue siendo la autoridad ante pedidos concurrentes.

### Almacenamiento privado de comprobantes

`orders-service` guarda comprobantes bajo claves UUID opacas en un directorio privado del filesystem. En desarrollo usa `PAYMENT_EVIDENCE_LOCAL_DIR` (por defecto, un directorio temporal); en producción el servicio exige que se configure una ruta absoluta fuera del directorio temporal, por ejemplo `/var/lib/mileshop/payment-evidence`. Esa ruta **debe estar respaldada por un volumen persistente** del servidor; la variable y el uso de disco local, por sí solos, no garantizan persistencia ante reemplazo o pérdida de la VM.

Los archivos no se sirven como estáticos ni se exponen mediante enlaces públicos: la descarga pasa por Gateway, que verifica el rol `STORE_ADMIN`, y Orders. La administradora puede descargarlos y luego usar **“Ya lo guardé, eliminar del servidor”**. La aplicación solicita confirmación, elimina solo la copia privada del servidor, registra actor, hora y motivo y mantiene el pedido/comprobante en la cola de revisión. Después de esa confirmación, la administradora todavía puede resolver el pago usando la copia que guardó localmente; la descarga por sí sola nunca elimina el archivo. Volver a solicitar la eliminación es idempotente y un legal hold impide borrarla.

Configura un respaldo y ensaya la recuperación del volumen junto con la base de Orders; la copia de la base no incluye los archivos. Este almacenamiento en una sola VM es una estrategia de bajo costo, no alta disponibilidad ni una garantía contra pérdida del host.

La validación acepta únicamente PDF, JPEG y PNG con extensión, MIME y firma de contenido coincidentes, nombres de archivo sin controles y un límite de 10 MiB. La interfaz de almacenamiento ofrece lectura en flujo y eliminación idempotente para que las capas de autorización y retención las implementen sin exponer claves ni rutas.

El cliente usa `POST` y `GET /api/orders/{orderId}/payment-evidence` en la aplicación web. La gateway vuelve a verificar la identidad contra `identity-service`; `orders-service` autoriza la carga únicamente al propietario mientras el pedido espera el comprobante, y permite la lectura al propietario o a un `STORE_ADMIN` verificado. La descarga es privada, se transmite como adjunto y usa `Cache-Control: private, no-store`. Los endpoints internos de `orders-service` no deben exponerse como rutas públicas ni servirse directamente desde el almacenamiento.

El seguimiento del cliente está disponible en `/orders/{orderId}`. La página consulta `GET /api/orders/{orderId}` sin caché; el proxy web usa la cookie httpOnly y la gateway verifica la identidad antes de que `orders-service` devuelva el pedido únicamente a su propietario. La respuesta incluye el vencimiento de reserva y, cuando existe, el resultado y la razón de la decisión administrativa. Un rechazo se presenta explícitamente como pago rechazado y pedido cancelado, muestra el motivo guardado y advierte que no debe realizarse otro pago para ese pedido; una respuesta rechazada sin motivo se considera inválida. Antes de enviar el comprobante, el propietario puede cancelar una reserva activa desde el seguimiento; la página confirma la acción y presenta la liberación en curso. La expiración se presenta separada del rechazo como reserva vencida, sin opción de pagar el pedido expirado. El flujo de checkout dirige al cliente a esta página y no presenta como confirmado un pedido que aún está reservando inventario.

La revisión administrativa expone `GET /admin/payments` (cola ordenada por recepción), `GET /admin/payments/{orderId}` (detalle y disponibilidad del comprobante), `GET /admin/payments/{orderId}/evidence` (descarga privada) y `POST /admin/payments/{orderId}/evidence` (eliminación de la copia tras confirmar la descarga). Cada ruta de Gateway requiere identidad verificada por `identity-service` y `STORE_ADMIN`; la gateway propaga al servicio interno solo las claims verificadas y el token interno compartido. La cola y el detalle incluyen pedidos `PAYMENT_REVIEW_PENDING` que tengan un registro de comprobante, incluso si su archivo fue eliminado manualmente; ese pedido sigue disponible para aprobar o rechazar. Las respuestas usan `Cache-Control: private, no-store`; no se exponen claves de almacenamiento ni se aceptan identificadores de cliente como autorización.

La interfaz `/admin/payments` consume esos endpoints mediante proxies web con cookie httpOnly, maneja estados de sesión/permisos y permite revisar datos, líneas, totales, descargar y, tras una confirmación explícita de copia guardada, eliminar el archivo del servidor, aprobar o rechazar el pago. La eliminación registra el administrador, fecha y motivo sin quitar el pedido de la cola ni borrar sus metadatos de revisión; las decisiones siguen disponibles para que la administradora resuelva usando su copia local. No se elimina el archivo al abrir ni descargarlo. `POST /admin/payments/{orderId}/approve` solo está disponible para `STORE_ADMIN`: registra una única decisión con el identificador verificado del administrador y la hora del servidor, y crea el comando `COMMIT` en la misma transacción que cambia el pedido a `PAYMENT_APPROVED_FINALIZING`. El outbox reintenta el commit idempotente en Catálogo; el pedido pasa a `CONFIRMED` solo cuando Catálogo confirma el compromiso de la reserva. Si Catálogo aún no confirma, el cliente ve que el pago fue aprobado y que el pedido se está finalizando. La decisión repetida de aprobar es idempotente; un pedido que ya no está pendiente devuelve conflicto. La aprobación nunca descuenta el stock una segunda vez: el commit reduce juntos el stock físico y el reservado, una sola vez, dentro de Catálogo.

Después de recibir el comprobante y mientras el pago siga en `PAYMENT_REVIEW_PENDING`, el cliente puede enviar `POST /api/orders/{orderId}/cancellation-request`. La solicitud no cambia el estado del pedido ni libera inventario; pausa la aprobación/rechazo hasta que un administrador la resuelva desde `/admin/payments`. El administrador puede mantener el pedido abierto o cancelarlo con una nota auditada. Para cancelar, primero debe registrar si hubo captura del pago; si la hubo, debe registrar la referencia del reembolso ya gestionado fuera de MileShop. La resolución de cancelación y el comando idempotente `RELEASE` se persisten juntos. MileShop no procesa ni confirma reembolsos. Este flujo se limita a pedidos en revisión: los pedidos aprobados/confirmados ya tienen inventario comprometido y requieren un flujo de restitución distinto.

`POST /admin/payments/{orderId}/reject` requiere `STORE_ADMIN` y una razón de 1 a 1000 caracteres. Registra la decisión rechazada, el administrador verificado, la hora del servidor y el comando idempotente `RELEASE` en una única transacción; el worker intenta liberar la reserva inmediatamente y mantiene los reintentos durables si Catálogo no está disponible. Los rechazos repetidos no crean otra decisión ni otra liberación; un pago que ya no está pendiente devuelve conflicto. El seguimiento del cliente expone el motivo persistido.

La gateway autentica su salto a `orders-service` con `ORDERS_INTERNAL_TOKEN`, que debe configurarse con el mismo valor aleatorio de al menos 32 caracteres en ambos servicios. El servicio rechaza las rutas de comprobantes si el token falta o no coincide; no uses un valor por defecto ni lo guardes en el repositorio.

### Retención y eliminación de comprobantes

Antes de desplegar esta versión, aplica la migración únicamente contra la base de `orders-service` con `npm run db:deploy --workspace @mileshop/orders-service`. La migración asigna a comprobantes de pedidos ya terminales una fecha de retención calculada desde `Order.updatedAt`; los nuevos cierres fijan el vencimiento a 12 meses calendario después del cierre (si el día no existe, se usa el último día del mes).

La limpieza automática está desactivada por defecto. Solo se activa si `PAYMENT_EVIDENCE_RETENTION_ENABLED=true`; antes de habilitarla en cualquier entorno con datos reales, exige aprobación documentada de legal/contabilidad para el plazo y el proceso. Una vez habilitada, el worker revisa al iniciar y cada cinco minutos, reclama hasta 25 comprobantes vencidos por 60 segundos y omite los que tengan una retención legal activa. `POST` y `DELETE /admin/payment-evidence/{orderId}/legal-hold` en Gateway requieren identidad verificada y `STORE_ADMIN`, y guardan el administrador, fecha y motivo de cada cambio. Al vencer la retención, el worker elimina primero el archivo privado y después marca el registro como eliminado y limpia los metadatos personales. La limpieza manual posterior a descarga conserva los metadatos necesarios para la revisión y registra el motivo/administrador. Si el almacenamiento o la actualización fallan, el lease permite reintentar; la eliminación del archivo es idempotente.

La retención legal debe usarse para una obligación concreta o una disputa activa, con un motivo auditable. El plazo de 12 meses sigue siendo provisional y requiere aprobación contable/legal antes de activar la limpieza; esta decisión no puede sustituirse por una recomendación técnica. Mientras no exista aprobación, mantén `PAYMENT_EVIDENCE_RETENTION_ENABLED=false`. Esta limpieza no sustituye las obligaciones aplicables de conservación, privacidad o respuesta a disputas.

### Provisionamiento inicial de la propietaria

El permiso inicial de tienda se concede solo después de aplicar la migración de `identity-service` y registrar la cuenta de la propietaria. Configura `DATABASE_URL` para la base de identidad y ejecuta una sola vez:

```powershell
npm run db:deploy --workspace @mileshop/identity-service
npm run admin:bootstrap --workspace @mileshop/identity-service -- propietaria@example.com
```

El comando solo acepta una cuenta existente, registra la concesión y rechaza cualquier ejecución posterior. No existe un campo público de registro ni una ruta HTTP para elevar privilegios. Nunca ejecutes la migración con la conexión de otro servicio.

## 6. Despliegue, migraciones y recuperación

### Entorno local

`infra/docker-compose.yml` inicia únicamente las bases PostgreSQL; no construye ni inicia los servicios de aplicación. Para el stack local completo, inicia las bases y aplica las migraciones locales:

```powershell
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
npm run db:deploy
```

El script raíz usa puertos, usuarios y contraseñas fijos de desarrollo en `localhost`; no lo uses contra producción ni staging. Para ejecutar una migración de un solo servicio, configura `DATABASE_URL` con la conexión exclusiva de ese dominio y ejecuta `npm run db:deploy --workspace @mileshop/<servicio>`. Nunca compartas una URL de base entre servicios.

`services/orders-service/.env.example` es una plantilla, no la carga automáticamente Node.js. Configura esos valores en el entorno del proceso. `PAYMENT_EVIDENCE_LOCAL_DIR=../../.data/payment-evidence` está pensado para ejecutar Orders desde su workspace; la ruta es relativa al directorio de trabajo del proceso. `.data/` está excluido de Git y conserva archivos entre reinicios locales. Protege ese directorio como información privada, no lo publiques ni lo montes en un contenedor PostgreSQL. En producción, configura `PAYMENT_EVIDENCE_STORAGE=local` y un `PAYMENT_EVIDENCE_LOCAL_DIR` absoluto fuera de las rutas temporales, montado en un volumen privado y persistente; Orders falla al iniciar si falta o apunta al directorio temporal.

`npm run verify:local-purchase` usa los puertos locales predeterminados. Si el stack actual está aislado en otros puertos, define `MILESHOP_GATEWAY_URL`, `MILESHOP_NOTIFICATION_WORKER_URL`, `MILESHOP_ORDERS_SERVICE_URL` y `MILESHOP_IDENTITY_SERVICE_URL` antes de ejecutarlo; así el smoke test no termina usando servicios de otro repositorio que ocupen los puertos predeterminados.

### Despliegue de una versión

Antes de migrar una base persistente:

1. Verifica que el artefacto y la revisión de la migración correspondan al release; ensaya el procedimiento en una copia representativa.
2. Toma y verifica una copia de seguridad recuperable de cada base de datos del servicio y del almacenamiento privado de comprobantes. La copia de la base no contiene los objetos privados.
3. Genera los clientes Prisma de la misma revisión (`npm run db:generate`) y aplica cada migración con la `DATABASE_URL` de su propio servicio:

   ```powershell
   $env:DATABASE_URL = "<URL-de-la-base-catalog>"
   npm run db:deploy --workspace @mileshop/catalog-service
   $env:DATABASE_URL = "<URL-de-la-base-notifications>"
   npm run db:deploy --workspace @mileshop/notification-worker
   $env:DATABASE_URL = "<URL-de-la-base-orders>"
   npm run db:deploy --workspace @mileshop/orders-service
   $env:DATABASE_URL = "<URL-de-la-base-identity>"
   npm run db:deploy --workspace @mileshop/identity-service
   Remove-Item Env:DATABASE_URL
   ```

   Los marcadores se sustituyen en el entorno de despliegue; no guardes URLs reales en comandos persistidos, archivos versionados o registros de CI.
4. Despliega los servicios compatibles con el esquema migrado. Aplica la migración de identidad y confirma que `/auth/me` devuelve el rol antes de desplegar una Gateway que lo requiera. Orders, Catálogo e Identity deben tener sus respectivas migraciones antes de iniciar las versiones que usan sus nuevos campos. No habilites la limpieza de comprobantes en producción hasta disponer del adaptador privado, sus copias de seguridad y aprobación contable/legal del plazo y proceso de retención.
5. Verifica salud, autenticación, permisos administrativos, operaciones idempotentes, métricas/logs y entregas pendientes antes de habilitar tráfico. Conserva el release anterior y el plan de recuperación hasta cerrar la validación.

El historial Prisma es la fuente de verdad: `migrate deploy` aplica migraciones pendientes y no genera migraciones nuevas. No edites una migración que ya se aplicó en un entorno compartido.

### Rollback de aplicación y recuperación de esquema/datos

Prisma no ofrece un rollback automático seguro para estas migraciones. No borres tablas/columnas, no reviertas manualmente `_prisma_migrations` y no ejecutes `migrate resolve` como sustituto de una reparación. Si falla una migración, detén el despliegue, inspecciona el error y `prisma migrate status` con la URL del servicio afectado; conserva los logs y sigue con una reparación revisada o una migración correctiva hacia delante. Restaura una copia de seguridad solo con un plan coordinado para la base y los datos/objetos privados.

Un rollback de aplicación solo es seguro mientras el esquema siga siendo compatible con la versión anterior y no haya cambiado la semántica de datos que esta espera. En particular, la limpieza T022 deja comprobantes eliminados como registros con `storageKey`, nombre y MIME nulos; una versión anterior que presuponga esos metadatos no puede atender esos registros. Además, la eliminación del objeto es irreversible sin una copia de almacenamiento. Si la limpieza ya comenzó, detén el worker, conserva la evidencia restante y recupera mediante restauración o un arreglo hacia delante; no despliegues a ciegas una versión anterior.

### Outbox: operación y recuperación

Orders persiste eventos y comandos de inventario en outboxes durables. Los workers recuperan al iniciar y sondeos posteriores; un claim `PROCESSING` abandonado puede reclamarse al expirar su lease. Los fallos transitorios se reintentan con esperas exponenciales desde 5 segundos hasta 5 minutos. Tras ocho intentos, el elemento queda `FAILED`, genera un error que requiere intervención y no vuelve a procesarse automáticamente. Un `PENDING` atrasado suele indicar que el destino o la configuración no están disponibles; un `FAILED` requiere conciliación operativa.

Para investigar, consulta los logs de Orders, Gateway y Catálogo; comprueba conectividad, estado de salud y que `CATALOG_INVENTORY_COMMAND_TOKEN` esté configurado con el mismo secreto en Catálogo y Orders. Revisa solo metadatos necesarios del outbox, por ejemplo:

```sql
SELECT "commandId", "orderId", "commandType", "status", "attemptCount",
       "nextAttemptAt", "lastError", "updatedAt"
FROM "InventoryCommandOutbox"
WHERE "status" IN ('PENDING', 'PROCESSING', 'FAILED')
ORDER BY "updatedAt";
```

Compara el estado persistido del pedido y el comando con la reserva del mismo `orderId` en Catálogo antes de cualquier intervención. Catálogo hace idempotentes las operaciones con la misma clave e identidad de comando, pero eso no hace seguro repetir un comando distinto ni demuestra por sí solo el resultado de una operación externa. No cambies estados, contadores, claims ni payloads directamente en SQL y no elimines filas. El repositorio aún no expone una operación administrativa para reencolar `FAILED`; hasta definir y revisar un procedimiento auditado de conciliación/replay, escala estos casos y no los fuerces manualmente.

La pérdida del worker no elimina la intención durable: al volver a estar disponible, revisará los elementos pendientes y claims vencidos. La cola de notificaciones también usa un outbox independiente; diagnostícala con sus logs y su base, sin editar las tablas de otro servicio.

## 7. Verificación local antes de abrir PR

Desde la raíz del repositorio:

```powershell
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --audit-level=high
docker compose -f infra/docker-compose.yml config
```

Además, por servicio:

```powershell
npm run typecheck --workspace @mileshop/api-gateway
npm run typecheck --workspace @mileshop/catalog-service
npm run typecheck --workspace @mileshop/orders-service
npm run test --workspace @mileshop/api-gateway
npm run test --workspace @mileshop/catalog-service
npm run test --workspace @mileshop/orders-service
```

Las migraciones se aplican con su `DATABASE_URL` del dominio correspondiente y nunca contra la base de otro servicio.

## 8. Flujo recomendado de trabajo

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b feature/catalog-product-list
# trabajo
 git add .
git commit -m "feat(catalog): add product listing"
git push -u origin feature/catalog-product-list
```

Luego:

1. abrir PR hacia `develop`;
2. validar CI;
3. solicitar revisión;
4. hacer merge cuando esté limpio;
5. preparar release desde `develop`.

## 9. Release y promoción a producción

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b release/2026.09.13
git push -u origin release/2026.09.13
```

La rama de release se usa para:

- validar el bundle final;
- ejecutar pruebas de integración y smoke tests;
- documentar riesgo y rollback;
- preparar evidencia de release.

Después, `main` recibe el merge final con revisión y una evidencia clara del cambio.

## 10. Rollback y recuperación

Si un release falla:

1. identificar causa real y evidencia;
2. revert del PR o del merge con trazabilidad;
3. corregir la causa en rama de fix o hotfix;
4. volver a ejecutar validación;
5. promocionar solo con evidencia y sin ambigüedad.

## 11. Principios finales

- no mezclar tipos de trabajo en un mismo commit;
- no hacer merge sin evidencia;
- no trabajar directamente sobre ramas protegidas;
- documentar decisiones operativas con datos y contexto;
- mantener el repositorio legible, reproducible y auditable.
