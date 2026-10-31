# Auditoría técnica exhaustiva — MileShop Platform
**Fecha:** 2026-10-14  
**Auditor:** Agente de análisis read-only  
**Alcance:** mileshop-platform (monorepo completo)

---

## Resumen ejecutivo

MileShop Platform es un monorepo npm workspaces con cuatro servicios NestJS + Fastify (api-gateway, catalog-service, orders-service, notification-worker), un frontend Next.js 16 (App Router), un paquete de contratos compartidos y tres bases PostgreSQL independientes gestionadas con Prisma 6.12. **El stack compila, pasa typecheck, lint y tests, y ha sido ejecutado localmente con éxito** (evidencia en `.local-stack/startup.stdout.log`). La arquitectura real es coherente con la documentada. Los gaps principales son: ausencia de identidad persistente de cliente, falta de reserva de stock transaccional, producción del evento `OrderCreated.v1` en el gateway (no en `orders-service`), ausencia de outbox transaccional, y un módulo de registro de cliente que opera exclusivamente sobre `localStorage` sin validación en servidor.

---

## 1. Estructura del monorepo

```
mileshop-platform/
├── apps/
│   └── web/                   # Next.js 16.3.5, App Router, TypeScript estricto
├── packages/
│   └── contracts/             # @mileshop/contracts — tipo OrderCreatedV1 compartido
├── services/
│   ├── api-gateway/           # NestJS + Fastify :3000 — entrada pública
│   ├── catalog-service/       # NestJS + Fastify :3020 — catálogo + PostgreSQL :5434
│   ├── orders-service/        # NestJS + Fastify :3030 — pedidos + PostgreSQL :5435
│   └── notification-worker/   # NestJS + Fastify :3010 — notificaciones + PostgreSQL :5433
├── infra/
│   └── docker-compose.yml     # 3 PostgreSQL 17-alpine independientes
├── scripts/                   # PowerShell: start, stop, status, deploy-db, verify-purchase
├── docs/                      # ADRs, wiki, plan v1, runbooks
└── .github/workflows/ci.yml   # quality gates CI
```

**Gestor de paquetes:** npm 11.17.0 con workspaces  
**Node.js requerido:** 24 (CI usa `node: 24`)  
**TypeScript base:** `ES2022`, `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `module: NodeNext`  
**Test runner:** `node --import tsx --test` (Node.js built-in test runner)  
**Prisma:** 6.12.0 en catalog-service, orders-service y notification-worker

---

## 2. Análisis archivo por archivo

### 2.1 packages/contracts/src/index.ts

**Qué hace:** Define y exporta el tipo TypeScript `OrderCreatedV1`. Es el único contrato compartido entre servicios.

```typescript
export type OrderCreatedV1 = {
  eventType: "OrderCreated.v1";
  eventId: string;
  occurredAt: string;
  aggregateId: string;
  payload: {
    customerId: string;
    totalCop: number;
    currency: "COP";
    lines: Array<{
      productId: string; sku: string; name: string;
      quantity: number; unitPriceCop: number;
    }>;
  };
};
```

**Patrón:** Shared Kernel (DDD) — contrato de tipo puro sin runtime.  
**Dependencias:** ninguna.  
**Tests:** ninguno — es solo un tipo, no tiene lógica testeable.  
**Deuda técnica:**
- El `package.json` exporta directamente el `.ts` fuente (`"./src/index.ts"`) sin compilar. Funciona con tsx pero no es un artefacto publicable.
- La versión del evento está en el string literal (`"OrderCreated.v1"`) pero no hay ningún mecanismo de evolución del esquema (sin registro de versiones, sin validación Zod del lado del productor en el paquete).
- El tipo `OrderCreatedV1` no usa `occurredAt` como `Date` sino como `string` — consistente pero requiere que el consumidor haga el parse si necesita operar temporalmente.

---

### 2.2 apps/web/src/

#### apps/web/src/app/layout.tsx
Raíz del App Router. Define metadata (`title`, `description`, iconos SVG). Estructura HTML semántica (`html lang="es"`, `body`). Sin estado, sin cliente.  
**Deuda:** `favicon.svg` no existe en el repositorio auditado (solo `favicon.ico` en el listado de archivos).

#### apps/web/src/app/globals.css
CSS puro sin framework de clase. Define variables CSS (`--background`, `--foreground`, `--accent`, etc.), layout de `site-shell`, `topbar`, `catalog-page`, `product-grid`, `cart-panel`, `checkout-*`. Incluye media query para móvil (≤760px).  
**Observación:** usa `@import "tailwindcss"` y `@theme inline` lo que corresponde a Tailwind v4 (CSS-first, sin clases en JSX). El diseño real está en CSS custom, no en clases utilitarias de Tailwind — Tailwind aquí solo provee el reset y las variables de tema.

#### apps/web/src/app/page.tsx
Server Component. Llama `getCatalog()` desde el servidor usando `API_GATEWAY_URL` (env var) con `cache: "no-store"`. Maneja tres estados: productos disponibles, catálogo vacío, servicio no disponible. Delega renderizado a `<CatalogShell />`.  
**Seguridad:** La URL del gateway no se expone al cliente (correcto — env var sin prefijo `NEXT_PUBLIC_`).  
**Deuda:** El tipo `Product` en `page.tsx` está duplicado localmente en lugar de ser importado de `@mileshop/contracts`. El contrato compartido solo define `OrderCreatedV1`, no el modelo de `Product`.

#### apps/web/src/app/register/page.tsx
`"use client"`. Formulario de registro: nombre, teléfono, email. Valida campos en cliente. Persiste `customerId` (= email.toLowerCase()) y `profile` en `localStorage`. Redirige a `/` tras registrar.  
**Gaps de seguridad críticos:**
- El `customerId` derivado de email no está validado en el servidor — cualquiera puede escribir el email de otro cliente.
- No existe unicidad ni existencia verificada por el backend.
- Almacenar el perfil completo (nombre, teléfono, email) en `localStorage` es un vector de exfiltración si la app corre en un dispositivo compartido.
- No hay validación de formato de teléfono real (solo `type="tel"`).
- No hay protección contra XSS en el valor almacenado (riesgo bajo en contexto propio pero debe documentarse).

#### apps/web/src/app/checkout/page.tsx
`"use client"`. Lee el pedido confirmado de `localStorage` (`mileshop-last-order-v1`). Muestra líneas, subtotal, envío y total. Maneja caso de pedido nulo con mensaje amigable. Usa `buildCheckoutSummary` para recalcular el resumen visual.  
**Observación:** El total mostrado usa `order.payload.totalCop` (valor del servidor), no `summary.totalCop` del recálculo local — correcto para evitar discrepancias. Sin embargo, `summary` sí se usa para subtotal y flete, lo que podría diferir si el servidor aplica lógica diferente.

#### apps/web/src/components/catalog-shell.tsx
`"use client"`. Componente principal del storefront. Gestiona:
- Carrito en `useState` persistido en `localStorage` (`mileshop-cart-v1`).
- Panel lateral de carrito (slide-in CSS).
- Flujo de checkout: verifica `customerId` → si falta redirige a `/register` → hace `POST /orders` al gateway.
- Persiste el resultado del pedido en `localStorage` → redirige a `/checkout`.

**Patrones:** State Management local puro (no Redux/Zustand), patrón funcional puro para mutaciones del carrito.  
**Deuda:**
- `window.alert()` para errores de checkout — UX pobre, sin estado de error gestionado.
- El carrito no revalida stock antes de confirmar — puede confirmar con stock desactualizado.
- El tipo de `payload` en `handleCheckout` está inline duplicado (no importado de contratos).
- No existe manejo de red parcial: si el POST al gateway supera el timeout del cliente (sin AbortController), la UI queda colgada.
- `NEXT_PUBLIC_API_GATEWAY_URL` tiene fallback a `http://localhost:3000` — expone la URL del gateway al bundle del cliente en producción (riesgo de exposición de topología interna si el gateway no tiene un DNS público separado).

#### apps/web/src/lib/cart.ts
Funciones puras: `addProductToCart`, `updateProductQuantity`, `removeProductFromCart`, `getCartItemCount`, `getCartSubtotal`.  
**Patrón:** Pure functions / Immutable state. Sin efectos secundarios, sin dependencias externas.  
**Calidad:** Excelente. Bien nombrado, predecible, totalmente testeable.  
**Deuda:** Ninguna significativa. El `Math.max(0, quantity)` en `updateProductQuantity` maneja correctamente la remoción por cantidad 0.

#### apps/web/src/lib/order.ts
Funciones de dominio de presentación: `buildCheckoutSummary` (subtotal, flete, umbral de envío gratis 150.000 COP, flete mínimo 12.000 COP con 8%) y `buildOrderCreatedEvent` (construye `OrderCreatedV1` con `Date.now()` como orderId).  
**Dependencias:** `@mileshop/contracts` (único uso real del paquete).  
**Deuda:**
- `buildOrderCreatedEvent` genera `orderId` con `Date.now()` — colisión posible en entornos de alta concurrencia o pruebas paralelas.
- La función `buildOrderCreatedEvent` no se usa en `catalog-shell.tsx` — el evento real lo construye el gateway; esta función es código muerto en el frontend productivo (pero se usa en los tests de `order.test.ts`).
- La lógica de flete (8% con mínimo 12.000 COP) está duplicada conceptualmente con lo que el gateway devuelve; si el servidor cambia la lógica, el frontend mostraría valores inconsistentes en la pantalla de checkout.

#### apps/web/src/lib/cart.test.ts
2 tests con `node:test` y `assert/strict`. Cubre: acumulación de cantidad al agregar el mismo producto, actualización de cantidad, eliminación y recálculo de subtotal.  
**Cobertura:** Buena para el caso happy path. Falta: carrito vacío, cantidad negativa enviada como input, producto con `quantity: 0`.

#### apps/web/src/lib/order.test.ts
3 tests. Cubre: cálculo de envío gratis por umbral, construcción de evento con cliente identificado, rechazo sin `customerId`.  
**Cobertura:** Buena. Falta: líneas con `quantity: 0` (¿se filtran?), umbral exacto (149.999 vs 150.000), cálculo de flete para pedidos pequeños.

---

### 2.3 services/api-gateway/src/

#### main.ts
Bootstrap NestJS con `FastifyAdapter`. Configura:
- CORS con `ALLOWED_ORIGINS` (env var, separado por comas, default `http://localhost:3000`).
- `@fastify/helmet` (CSP desactivado — `contentSecurityPolicy: false`).
- `@fastify/rate-limit` (120 req/min por IP, configurable con `RATE_LIMIT_MAX`).
- Puerto: `PORT` env var, default 3000.
- `enableShutdownHooks()`.

**Deuda:**
- `(app as any).register(...)` — cast a `any` para registrar plugins Fastify. Es un workaround documentado para la integración NestJS/Fastify pero deja el tipado roto. Alternativa: usar `app.getHttpAdapter().getInstance().register(...)` con tipado correcto.
- CSP desactivado — riesgo XSS real en producción si no se configura en un proxy delante.
- No hay logging estructurado ni correlación de trazas.

#### app.module.ts
Módulo raíz. Registra `GatewayController`, `CatalogClient`, `OrderService` y sus tokens de inyección (`CATALOG_FETCH`, `ORDER_FETCH`, `NOTIFICATION_WORKER_URL`, `ORDERS_SERVICE_URL`). Inyecta `fetch` global como adaptador HTTP (Dependency Inversion).

#### catalog.client.ts
`@Injectable()`. Consulta `CATALOG_SERVICE_URL/products` con timeout de 3s (`AbortSignal.timeout(3_000)`). Mapea cualquier error a `ServiceUnavailableException (503)`.  
**Patrón:** Adapter / Port (DIP). El fetcher se inyecta → testeable sin mocks de módulo.  
**Deuda:**
- `baseUrl` se lee de `process.env` directamente en la clase en lugar de inyectarse por token — inconsistente con el patrón del mismo archivo donde `fetcher` sí se inyecta.
- No hay retry ni circuit breaker.
- El cast `as CatalogResponse` sin validación Zod significa que un cambio de contrato en catalog-service silenciaría un error en producción.

#### gateway.controller.ts
Controller limpio con tres rutas: `GET /healthz`, `GET /catalog/products`, `POST /orders`. Delega completamente a `CatalogClient` y `OrderService`. Sin lógica de negocio.  
**Patrón:** Thin Controller — correcto.  
**Deuda:** `POST /orders` no valida el body de entrada con un DTO/pipe de NestJS (`ValidationPipe` + `class-validator`). Cualquier body malformado llega directamente al `OrderService` y el error puede no ser controlado.

#### orders.service.ts
Orquesta la creación de pedido: POST a `ORDERS_SERVICE_URL`, construye el evento `OrderCreated.v1`, POST a `NOTIFICATION_WORKER_URL`. Timeout de 3s en cada llamada.  
**Problema arquitectural crítico:** El evento `OrderCreated.v1` lo construye el **gateway**, no `orders-service`. Esto viola el principio de que el productor del evento debe ser el bounded context dueño del agregado. Si `orders-service` alguna vez produce el evento directamente (para un outbox transaccional), habrá duplicación. La documentación reconoce esto en `BL-05` del backlog.  
**Deuda adicional:**
- Si el POST a `notification-worker` falla **después** de persistir el pedido en `orders-service`, el pedido existe pero la notificación nunca se envía y no hay mecanismo de reintento durable.
- El `eventId` se genera como `${orderId}-event` — determinístico, lo que es bueno para deduplicación, pero podría colisionar si se retransmite el mismo evento con un ID diferente.
- Falta manejo del caso en que `orders-service` devuelve `500` (solo maneja `400` y genérico).

#### test/catalog.client.test.ts
2 tests. Cubre: respuesta exitosa con productos, fallo upstream mapeado a 503.  
**Calidad:** Conciso y efectivo. Usa inyección del fetcher para evitar HTTP real.

#### test/orders.service.test.ts
2 tests. Cubre: flujo completo (persiste orden + publica evento), mapeo de `400` a `BadRequestException`.  
**Falta:** Test de fallo del notification-worker después de persistir el pedido (el gap más crítico), test de timeout (3s).

---

### 2.4 services/catalog-service/src/

#### main.ts
Bootstrap sin helmet ni rate-limit — **servicio interno**, correcto. Puerto 3020.  
**Deuda:** Sin `enableCors()` explícito — asumido correcto ya que es interno, pero debería documentarse.

#### app.module.ts
Módulo con estrategia de store dual: si `DATABASE_URL` está presente → `PrismaCatalogStore`; si no → `InMemoryCatalogStore`. Permite desarrollo sin PostgreSQL.  
**Patrón:** Strategy + Factory Provider. Bien implementado.  
**Deuda menor:** `"PRISMA_CLIENT"` inyecta `PrismaService` pero el tipo declarado es `PrismaClient | null` — el null se maneja pero la lógica del factory es un poco contorsionada.

#### catalog.service.ts
Define `CatalogStore` (interfaz), `InMemoryCatalogStore` (implementación en memoria con 3 productos hardcoded), `CatalogService` (wrapper que delega al store).  
**Patrón:** Repository Pattern + Dependency Inversion.  
**Deuda:**
- Los 3 productos en `InMemoryCatalogStore` (`MILE-MUG-001`, `MILE-BAG-001`, `MILE-NOTE-001`) difieren de los 4 productos en la BD real (el log de startup muestra `MILE-BTL-001` — Botella térmica — que solo existe en la BD, no en la memoria). Esto causa que tests que verifican el in-memory store no reflejen la data real.
- `CatalogService` no tiene `@Injectable()` — se instancia manualmente en el factory del módulo, lo que es coherente pero inconsistente visualmente con las clases que sí usan `@Injectable()`.

#### catalog.controller.ts
`GET /healthz` y `GET /products`. Thin controller. `@Inject("CATALOG_SERVICE")` para resolver la instancia.

#### prisma.service.ts
`PrismaService extends PrismaClient implements OnModuleDestroy`. Limpieza correcta con `$disconnect()` en destroy.

#### prisma.catalog.store.ts
`PrismaCatalogStore implements CatalogStore`. Query: `findMany({ where: { isActive: true }, orderBy: { name: "asc" } })`. Usa `select` explícito — no expone campos internos.  
**Deuda:** Sin paginación — si el catálogo crece, esta query es un full scan sin límite.

#### prisma/schema.prisma
```prisma
model Product {
  id String @id @default(cuid())
  sku String @unique
  name String / description String
  priceCop Int / stock Int
  isActive Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([isActive, name])
}
```
**Evaluación:** Correcto, índice compuesto sobre campos de consulta frecuente. `priceCop` e `stock` como `Int` — correcto para moneda COP (sin decimales).

#### prisma/seed.ts
Upsert idempotente por `sku`. Desactiva SKUs ausentes. Se puede ejecutar múltiples veces sin duplicados.  
**Deuda:** El seed no incluye `MILE-BTL-001` (Botella térmica) que sí existe en la BD del startup log — hay un producto en producción que no está en el seed controlado.

#### test/catalog.service.test.ts
1 test. Verifica 3 productos del in-memory store y el ordenamiento alfabético.  
**Cobertura:** Mínima. Falta: catálogo vacío, `isActive: false` no aparece, consulta al PrismaCatalogStore (requeriría mock).

---

### 2.5 services/orders-service/src/

#### main.ts
Bootstrap con helmet + rate-limit (igual que gateway). CORS configurado con `ALLOWED_ORIGINS`. Puerto 3030.  
**Deuda:** El `catalogServiceUrl` se lee pero no se pasa al `AppModule` — se resuelve dentro del módulo. El `console.info` lo imprime pero es solo cosmético.

#### app.module.ts
4 providers: `PrismaService`, `ORDERS_REPOSITORY` (→ `PrismaOrdersRepository`), `CATALOG_READER` (→ `HttpCatalogReader`), `ORDERS_SERVICE` (→ `OrdersService`). Sin fallback in-memory para repositorio de órdenes — requiere PostgreSQL activo.  
**Deuda:** A diferencia de catalog-service, no hay in-memory fallback para `ORDERS_REPOSITORY`. Desarrollo sin Docker no es posible.

#### orders.types.ts
Define: `OrderStatus` (`PENDING | CONFIRMED | CANCELLED`), `OrderLineInput`, `CreateOrderCommand`, `CreateOrderInput`, `OrderLine`, `Order`.  
**Observación:** `CreateOrderCommand` y `CreateOrderInput` son aliases del mismo tipo — redundante.

#### orders.validation.ts
Schema Zod v4: `orderLineSchema` y `createOrderSchema`. Valida tipos, longitudes mínimas y enteros.  
**Deuda:** `unitPriceCop: z.number().int().nonnegative()` acepta precio 0 — debería ser `.positive()` para evitar pedidos de productos gratuitos no intencionales.

#### orders.domain.ts
`OrderDomain.createOrder()` y `OrderDomain.toOrderView()`. Calcula `totalCop`, genera `orderId` con `Date.now()`.  
**Problema crítico:** `orderId = "order-${now.getTime()}"` — `Date.now()` tiene resolución de milisegundos. En cargas concurrentes o tests paralelos se pueden generar IDs idénticos. **Debería usar `crypto.randomUUID()` o `cuid()`** como hace Prisma en el campo `id`.  
**Deuda adicional:** `OrderRecord` tiene `id` y `orderId` — dos identificadores distintos. `id` es el PK de Prisma (cuid), `orderId` es el identifier de negocio. La redundancia es real y puede confundir.

#### orders.repository.ts
Define `OrdersRepository` (interfaz) e `InMemoryOrdersRepository` (implementación para tests). `structuredClone` para inmutabilidad en la respuesta.  
**Patrón:** Repository Pattern. Bien implementado.

#### orders.service.ts
Lógica de negocio central: valida con Zod, consulta catálogo activo, valida precio/SKU/stock por línea, crea el registro de dominio, persiste.  
**Patrón:** Application Service.  
**Característica notable:** canonicaliza el `name` de la línea desde el catálogo (ignora el nombre enviado por el cliente) — previene manipulación de nombres.  
**Problema de consistencia:** La validación de stock es optimista (`requestedQuantity > product.stock`), pero no hace un decremento atómico. Si dos pedidos llegan simultáneamente con el mismo producto al límite de stock, ambos pueden pasar la validación y ambos se persisten — **overselling potencial**.  
**Deuda:** `CatalogUnavailableError` se propaga al controller que la convierte en `503`, pero no hay retry ni fallback cuando el catálogo está caído.

#### catalog.reader.ts
`HttpCatalogReader implements CatalogReader`. Consulta `baseUrl/products` con timeout 3s. `CatalogUnavailableError` como error de dominio tipado.  
**Patrón:** Anti-corruption Layer / Adapter (DIP).  
**Deuda:** El doble try/catch es correcto para preservar el tipo del error, pero la estructura es verbosa.

#### orders.controller.ts
`POST /orders` y `GET /orders/:orderId`. Mapea `CatalogUnavailableError` → 503, otros errores → 400.  
**Deuda:**
- `GET /orders/:orderId` no maneja el caso `null` (pedido no encontrado) con un 404 apropiado — devuelve `{ data: null }` con status 200. Esto viola REST y puede confundir al cliente.
- Sin `ValidationPipe` global — el body de `POST /orders` llega como `CreateOrderInput` por inferencia de tipo pero sin validación de NestJS en runtime (la validación Zod está en `OrdersService.createOrder()`, lo que es correcto pero no estándar de NestJS).

#### prisma.orders.repository.ts
`upsert` por `orderId` con `deleteMany` de líneas en update. `findUnique` con `include: { lines: true }`.  
**Deuda:** El `upsert` en update hace `deleteMany` + `create` de líneas en lugar de un merge inteligente — correcto para snapshot inmutable pero ineficiente si se llamara repetidamente.

#### prisma.service.ts
Idéntico al de catalog-service. `$disconnect()` en destroy.

#### prisma/schema.prisma
```prisma
model Order { id cuid @id; orderId String @unique; customerId String; totalCop Int; status String DEFAULT "PENDING"; ... }
model OrderLine { id cuid @id; productId String; sku String; name String; quantity Int; unitPriceCop Int; orderId FK → Order.id }
@@index([customerId, createdAt]) / @@index([orderId, productId])
```
**Deuda:**
- `status` es `String` en lugar de un `enum` — pierde la verificación de valor en DB. El dominio define `PENDING | CONFIRMED | CANCELLED` pero la BD acepta cualquier string.
- `customerId` es un string sin foreign key a ninguna tabla de clientes — correcto por bounded context, pero no se puede garantizar integridad referencial.
- Sin `OrderLine.orderId` indexado individualmente — la FK existe pero el índice es `(orderId, productId)`, no solo `orderId`, lo que puede afectar algunas queries de lookup.

#### test/orders.service.test.ts
7 tests. Cubre: creación válida, rechazo sin líneas, precio manipulado, canonicalización de nombre, stock insuficiente, producto inexistente, construcción de dominio.  
**Evaluación:** Excelente cobertura de reglas de dominio. Falta: test de concurrencia/overselling, test de catálogo caído, test de timeout del catalog reader.

---

### 2.6 services/notification-worker/src/

#### main.ts
Bootstrap sin helmet ni rate-limit. Puerto 3010. Tabs de indentación inconsistentes (usa tabuladores en lugar de espacios — único archivo con este estilo).

#### app.module.ts
Providers: `InMemoryNotificationStore`, `LoggingNotificationSender`, `PrismaService`, `PRISMA_CLIENT`, `NOTIFICATION_STORE` (Prisma si DATABASE_URL, else in-memory), `NOTIFICATION_SENDER` (→ `LoggingNotificationSender`), `NOTIFICATION_WORKER`.  
**Deuda:** `NOTIFICATION_SENDER` usa `useExisting: LoggingNotificationSender` — solo hay un sender real (logging a consola). No existe adaptador de WhatsApp ni ningún canal de notificación real.

#### events.ts
Schema Zod v4 para `OrderCreated.v1`. `z.iso.datetime()` para `occurredAt`. Tipo derivado con `z.infer`.  
**Observación:** Este schema es la única validación formal del contrato de entrada del worker — bien implementado.

#### notification.worker.ts
`NotificationWorker`: llama `store.claim(eventId)`, si `"duplicate"` retorna, si `"claimed"` llama `sender.sendOrderCreated()` y luego `store.markSent()`. En error: `store.markFailed()` + re-throws.  
`InMemoryNotificationStore`: Map en memoria, estados `PROCESSING | SENT | FAILED`. `claim` marca `FAILED` como reclamable (retry).  
`LoggingNotificationSender`: Solo hace `console.info()` — no envía nada real.  
**Patrón:** Strategy (Store + Sender), Idempotency by eventId.  
**Deuda crítica:** `LoggingNotificationSender` es la única implementación de `NotificationSender` — **el sistema no envía ninguna notificación real** (WhatsApp, email, SMS). Es un stub de producción.

#### notifications.controller.ts
`POST /events/order-created` — valida con Zod, delega a worker.  
**Deuda:** `GET /healthz` no verifica conexión a DB.

#### prisma.notification.store.ts
`PrismaNotificationStore`. `claim()` usa `create()` con captura de `P2002` (unique violation) para deduplicación.  
**Patrón:** Database-level idempotency gate. Bien implementado.  
**Deuda:** La lógica de retry para `FAILED` (re-marca como `PROCESSING` e incrementa `attempts`) está en el store, no en el worker — viola SRP. El worker debería decidir si reintentar y el store solo registrar.

#### prisma/schema.prisma
```prisma
enum NotificationStatus { PROCESSING SENT FAILED }
model NotificationDelivery {
  id cuid @id; eventId String @unique; status NotificationStatus DEFAULT PROCESSING;
  attempts Int DEFAULT 1; lastError String?; processedAt DateTime?;
  @@index([status, createdAt])
}
```
**Evaluación:** Bien modelado. El índice `(status, createdAt)` permite consultas de limpieza operacional. El `eventId @unique` garantiza deduplicación a nivel de BD.

#### test/notification.worker.test.ts
1 test. Cubre: sent en primer intento, duplicate en segundo.  
**Falta:** Test de `FAILED` + retry, test de `markFailed` cuando el sender lanza error, test del `PrismaNotificationStore` (requeriría BD de test o mock).

---

## 3. Schemas Prisma — resumen comparativo

| Servicio | Modelos | Campos clave | Índices | Enum en DB |
|---|---|---|---|---|
| catalog-service | `Product` | `sku @unique`, `isActive`, `priceCop Int` | `(isActive, name)` | No |
| orders-service | `Order`, `OrderLine` | `orderId @unique`, `customerId`, `status String` | `(customerId, createdAt)`, `(orderId, productId)` | No — deuda |
| notification-worker | `NotificationDelivery` | `eventId @unique`, `status` enum, `attempts` | `(status, createdAt)` | Sí |

---

## 4. CI — .github/workflows/ci.yml

**Triggers:** PR y push a `main` y `develop`.  
**Pasos:** `npm ci` → `npm audit --audit-level=high` → `npm run db:generate` → `typecheck` → `lint` → `test` → `build` → `docker compose config`.  
**Permisos:** `contents: read` — mínimo necesario. Correcto.  
**Timeout:** 20 minutos.  
**Gaps:**
- No hay smoke test automatizado en CI (el `verify-local-purchase.ps1` solo corre localmente).
- No hay CD — no despliega a ningún entorno.
- No hay matriz de pruebas de integración (requeriría servicios levantados).
- `ubuntu-latest` + `npm ci` es correcto pero el script de local stack es PowerShell — los smoke tests no pueden correr en CI sin adaptación.

---

## 5. Infra — docker-compose.yml

Tres servicios PostgreSQL 17-alpine, cada uno con:
- credenciales distintas por servicio (correcto — no comparten usuario).
- healthcheck con `pg_isready`.
- volúmenes en `.data/` (ignorados en `.gitignore`).
- puertos: 5433 (notifications), 5434 (catalog), 5435 (orders).

**Deuda:** Las contraseñas están en texto plano en el compose file (`catalog:catalog`, etc.) — aceptable para desarrollo local, pero debe documentarse explícitamente como entorno de desarrollo solamente y nunca usarse en producción.

---

## 6. Scripts PowerShell

| Script | Función |
|---|---|
| `start-local-stack.ps1` | Docker up, migraciones, kill ports, start 4 services, wait healthz, smoke test |
| `stop-local-stack.ps1` | Kill ports 3000/3010/3020/3030, docker compose down |
| `status-local-stack.ps1` | Estado Docker, ports, health checks |
| `deploy-local-databases.ps1` | Solo migra las 3 bases, sin iniciar servicios |
| `verify-local-purchase.ps1` | E2E: health → catálogo → crear pedido → leer pedido → deduplicar evento |

**Observación:** `verify-local-purchase.ps1` es el smoke test más completo del sistema — valida el flujo completo de compra incluyendo deduplicación. Está bien estructurado con `Assert-Equal`. Solo funciona en Windows (PowerShell), lo que impide ejecutarlo en CI de GitHub Actions (Ubuntu).

---

## 7. Análisis de tests — resumen de cobertura

| Módulo | Nro tests | Casos cubiertos | Gaps principales |
|---|---|---|---|
| `web/lib/cart.test.ts` | 2 | Acumular, actualizar, quitar | Carrito vacío, qty negativa, qty 0 |
| `web/lib/order.test.ts` | 3 | Envío gratis, evento, sin customerId | Umbral exacto, flete < umbral |
| `api-gateway/catalog.client.test.ts` | 2 | OK, 503 | Timeout, body malformado |
| `api-gateway/orders.service.test.ts` | 2 | Flujo completo, 400 | Worker falla post-persist, timeout |
| `catalog-service/catalog.service.test.ts` | 1 | 3 productos + orden | Catálogo vacío, isActive false |
| `orders-service/orders.service.test.ts` | 7 | 6 reglas de dominio + domain build | Concurrencia/overselling, catálogo caído |
| `notification-worker/notification.worker.test.ts` | 1 | Sent + duplicate | FAILED+retry, sender error, Prisma store |

**Total:** 18 tests unitarios. Sin tests de integración automatizados. Sin tests E2E en CI.

---

## 8. Hallazgos de calidad y deuda técnica — clasificados por severidad

### CRÍTICO (bloquea operación comercial real)

1. **Sin implementación real de notificaciones** (`notification.worker.ts` → `LoggingNotificationSender`): el worker solo hace `console.info`. No hay WhatsApp, email ni SMS. El negocio requiere notificación comercial por pedido.

2. **Identidad de cliente sin validación en servidor** (`register/page.tsx`): el `customerId` es el email en minúsculas almacenado en `localStorage`. Cualquiera puede usurpar la identidad de otro cliente enviando el email ajeno. No hay autenticación ni sesión.

3. **Evento producido por el gateway, no por orders-service**: viola el principio de ownership del evento. Si `orders-service` falla entre la persistencia y el retorno al gateway, el gateway no construye el evento. Si la notificación falla después de persistir, no hay recuperación automática.

4. **Sin reserva transaccional de stock**: dos compras simultáneas pueden oversell el mismo producto. `orders-service` valida contra el catálogo pero no lo actualiza.

### ALTO (impacto en confiabilidad o seguridad)

5. **`orderId` generado con `Date.now()`** (`orders.domain.ts`): colisión bajo concurrencia o en tests paralelos. Debería ser `crypto.randomUUID()`.

6. **GET /orders/:orderId devuelve 200 con `data: null`** cuando el pedido no existe — debería ser 404.

7. **CSP desactivado en el gateway** (`main.ts`): `contentSecurityPolicy: false` en helmet — riesgo XSS en producción.

8. **CORS del gateway hardcodeado en fallback** a `http://localhost:3000`: en producción, si `ALLOWED_ORIGINS` no se configura, el CORS es incorrecto.

9. **Sin ValidationPipe de NestJS** en gateway y orders-service: bodies malformados no devuelven 400 estándar de NestJS, la validación está solo en lógica de servicio.

10. **`InMemoryCatalogStore`** tiene 3 productos; la BD real tiene 4 (falta `MILE-BTL-001`): tests del in-memory store no cubren todos los datos reales.

### MEDIO (deuda técnica / mantenibilidad)

11. **Tipo `Product` duplicado en `page.tsx`** y en `catalog.service.ts` — debería estar en `@mileshop/contracts`.

12. **`status` de `Order` es `String` en Prisma** en lugar de enum — pierde garantía de validez en DB.

13. **`buildOrderCreatedEvent`** en `order.ts` del frontend es código muerto en producción (solo usado en tests).

14. **`window.alert()`** en `catalog-shell.tsx` para error de checkout — UX pobre.

15. **Indentación con tabuladores** en `notification-worker/src/main.ts` — inconsistente con el resto del monorepo (espacios).

16. **`CatalogService` sin `@Injectable()`** — instanciación manual en factory, inconsistente visualmente.

17. **`@mileshop/contracts` exporta `.ts` directo** sin compilar — no publicable como paquete npm estándar.

18. **`verify-local-purchase.ps1` solo funciona en Windows** — el smoke test más completo no corre en CI de Ubuntu.

19. **Flete calculado en frontend y en servidor con lógica potencialmente divergente** — si el servidor cambia el cálculo, el checkout mostraría valores incorrectos hasta que se actualice el frontend.

20. **Sin paginación en catalog `/products`**: full scan sin límite. Aceptable con 3-4 productos, problemático con catálogos reales.

### BAJO (observaciones menores)

21. **`(app as any).register(...)`** en gateway y orders-service: cast a `any` para plugins Fastify.

22. **`baseUrl` leído de `process.env` directamente** en `CatalogClient` en lugar de inyección.

23. **`CreateOrderCommand` = `CreateOrderInput`** — alias redundante.

24. **Logs del startup con encoding incorrecto** (caracteres `ñ` como `\ufffd` en el log): el log de startup muestra `"Taza de cer\u00e9mica"` → `"Taza de cer??mica"` — encoding UTF-8 vs CP1252 en Windows PowerShell.

---

## 9. Estado real del código vs documentación

| Afirmación en la documentación | Estado real en el código |
|---|---|
| "El frontend, api-gateway, notification-worker, catalog-service y orders-service compilan y tienen pruebas" (README) | ✅ Verificado en startup.stdout.log |
| "El worker implementa deduplicación por eventId" (README) | ✅ Implementado en `PrismaNotificationStore.claim()` y `InMemoryNotificationStore.claim()` |
| "El gateway persiste pedidos mediante orders-service antes de publicar OrderCreated.v1" (README) | ✅ Correcto — pero el evento lo construye el gateway, no orders-service (mencionado en backlog BL-05) |
| "La migración desde Django es una estrategia futura" (README) | ✅ Correcto — no hay código de migración |
| "No existe actualmente un servicio de identidad" (architecture-overview.md) | ✅ Correcto — `customerId` es local al browser |
| "El carrito no consulta stock nuevamente antes de confirmar" (backlog BL-02) | ✅ Confirmado en `catalog-shell.tsx` — no hay revalidación |
| "El productor es el gateway, no orders-service" (backlog BL-05) | ✅ Confirmado en `api-gateway/src/orders.service.ts` |
| "No existe outbox transaccional" (backlog BL-05) | ✅ Confirmado — no hay tabla de outbox |
| "La notificación por WhatsApp debe incluir datos del cliente" (business-requirements.md) | ❌ NO implementado — `LoggingNotificationSender` solo hace console.info |
| "Administrador puede crear y editar productos" (PLAN-V1 §3.1) | ❌ NO implementado — no existe panel admin |
| "Pruebas de integración entre services y frontend" (PLAN-V1 §5.1) | ❌ NO implementadas en CI — solo el script PowerShell local |
| "GET /orders/:orderId devuelve el pedido" (architecture-overview.md) | ⚠️ Implementado pero con bug: devuelve 200+null si no existe |
| "Seed usa upsert idempotente por SKU" (ADR-0004) | ✅ Correcto — pero el seed no incluye MILE-BTL-001 que existe en BD |
| "Status del pedido: PENDING|CONFIRMED|CANCELLED" (domain) | ⚠️ Solo PENDING generado — CONFIRMED y CANCELLED no tienen endpoints |
| "SOLID se aplica para reducir acoplamiento" (CONTRIBUTING.md) | ✅ DIP bien aplicado en adapters e inyección; SRP aceptable; OCP parcial |

---

## 10. Conclusiones y recomendaciones priorizadas

### Antes de v1.0.0 (P0)

1. **Implementar al menos un NotificationSender real** — aunque sea email (nodemailer) o un webhook configurable. Sin esto, el "worker de notificaciones" es un stub en producción.

2. **Mover la producción del evento OrderCreated.v1 a orders-service** — el gateway debe recibir el evento ya construido, no construirlo. Implementar un outbox simple (tabla `DomainEvent` en orders-service) resuelve también el gap de recuperación.

3. **Reemplazar `Date.now()` por `crypto.randomUUID()`** en `orders.domain.ts` para el `orderId`.

4. **Agregar 404 en `GET /orders/:orderId`** cuando el pedido no existe.

5. **Documentar explícitamente que el registro de cliente es "contexto local temporal"** y decidir si v1 acepta esto o requiere identidad de servidor (decisión de negocio P0-04 del backlog).

6. **Agregar `MILE-BTL-001` al seed** de catalog-service o eliminarlo de la BD de desarrollo para alinear el estado real con el código.

### Post v1.0.0 (P1)

7. Reserva transaccional de stock (decremento atómico en catalog-service o locks de pedido).
8. ValidationPipe global en gateway y orders-service.
9. Paginación en `GET /products`.
10. CSP configurado en helmet del gateway.
11. Smoke tests adaptados para CI (bash/Node.js en lugar de PowerShell).
12. Enum de `status` en el schema Prisma de orders-service.

---

*Reporte generado en análisis read-only. Ningún archivo fue modificado.*
