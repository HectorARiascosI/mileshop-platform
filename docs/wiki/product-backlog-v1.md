# Backlog v1 de MileShop Platform

## 1. Regla de alcance

Este backlog distingue el runtime demostrado de las capacidades pendientes. Ningún item se considera terminado por tener documentación: necesita código, prueba y evidencia de ejecución cuando corresponda.

La v1 actual incluye el storefront web y cinco servicios ejecutables: API Gateway, Identity, Catalog, Orders y Notification Worker. `Proyecto_ventas` es legacy y no forma parte de este backlog.

## 2. Estados

- **Implementado:** existe código, prueba y evidencia suficiente para el alcance declarado.
- **Parcial:** existe una parte funcional, pero falta una dependencia o criterio importante.
- **Pendiente P0:** bloquea una venta o una validación operativa confiable.
- **Objetivo posterior:** no se implementa hasta que se apruebe su alcance y ownership.

## 3. Estado actual por capacidad

### BL-01 — Catálogo activo

**Estado:** Implementado para catálogo textual y disponibilidad.

**Evidencia:** `services/catalog-service`, schema Prisma, seed y `GET /products`; `apps/web` consume `GET /catalog/products`.

**Incluye hoy:** SKU, nombre, descripción, precio COP, stock, `isActive` y ordenamiento por nombre.

**No incluye:** imágenes, categorías, variantes, promociones, destacados ni paginación.

### BL-02 — Navegación y carrito

**Estado:** Implementado en `apps/web`.

**Evidencia:** `CatalogShell`, `cart.ts`, pruebas de carrito y flujo documentado.

**Incluye hoy:** agregar, quitar, cambiar cantidad, persistir carrito localmente, subtotal, costo de entrega y umbral de envío gratis.

**Limitación:** el carrito del navegador es informativo; la reserva real ocurre al enviar el pedido y es confirmada atómicamente por Catálogo. El usuario debe completar el pago dentro del plazo de reserva.

### BL-03 — Contexto de cliente antes del checkout

**Estado:** Implementado.

**Evidencia:** `services/identity-service`, flujo JWT con access token HS256 (15 min) y refresh token opaco (30 días), sesión con `httpOnly cookies` vía API routes de Next.js, `apps/web/src/app/login`, `apps/web/src/app/register`.

**Incluye hoy:** nombre, teléfono, correo, contraseña hasheada con `bcryptjs`, `customerId` persistente en base de datos propia, unicidad de correo validada en servidor y sesión segura mediante cookies.

**No incluye:** recuperación de cuenta por correo, OAuth social ni perfil de dirección.

### BL-04 — Creación y persistencia de pedido

**Estado:** Implementado para el pedido inicial.

**Evidencia:** `orders-service`, schema `Order`/`OrderLine`, migración, tests y lectura `GET /orders/:orderId`.

**Criterios cerrados:**

- valida `customerId` confirmado por gateway, líneas no vacías e `Idempotency-Key`;
- exige cantidades positivas y precios enteros no negativos;
- calcula subtotal, costo de entrega y total en el servidor;
- persiste pedido, líneas y evento outbox en una transacción de PostgreSQL;
- devuelve el pedido previo ante un reintento idéntico y responde `409` si la misma clave se usa con otro contenido;
- devuelve estado inicial `RESERVING_INVENTORY` y `orderId` único; pasa a `AWAITING_PAYMENT_PROOF` cuando Catálogo confirma la reserva.

**Incluye ahora:** reserva de inventario atómica e idempotente en Catálogo, transición del estado mediante outbox durable y liberación al cancelar, vencer o rechazar el pedido. La aprobación compromete la reserva una sola vez.

### BL-05 — Evento de pedido creado

**Estado:** Implementado para persistencia outbox y entrega HTTP con reintentos.

**Evidencia:** `packages/contracts`, `orders-service` y su transacción Prisma, `OrderEventOutbox`, pruebas de pedidos y `POST /events/order-created`.

**Incluye hoy:** evento `OrderCreated.v1` persistido atómicamente con el pedido y entregado por HTTP con lease exclusivo, backoff exponencial y límite de ocho intentos.

**Limitación:** no existe broker externo; la entrega HTTP es al menos una vez y depende de la deduplicación del consumidor.

### BL-06 — Deduplicación de notificaciones

**Estado:** Parcial implementado.

**Evidencia:** `notification-worker`, `NotificationDelivery`, índice único por `eventId` y test de retry.

**Incluye hoy:** claim idempotente con lease/token, recuperación tras lease vencido, estados `PROCESSING`, `SENT`, `FAILED` y contador de intentos.

**No incluye:** adaptador externo real, entrega por WhatsApp, cola durable ni métricas.

### BL-07 — Runtime local reproducible

**Estado:** Parcial para desarrollo local.

**Evidencia:** `infra/docker-compose.yml`, migraciones Prisma y runbooks en `CONTRIBUTING.md` y `docs/STACK_OPERATIONS.md`.

**Incluye hoy:** cuatro PostgreSQL locales, migraciones por servicio, script para iniciar servicios backend, health checks y smoke de compra idempotente. El storefront Next.js se inicia aparte.

**Limitación:** Compose solo administra las bases; el script `start-local-stack.ps1` inicia backend y bases en puertos predeterminados. Antes de usar `stop-local-stack.ps1`, identifica los procesos en esos puertos: el script los detiene sin validar su workspace. Esto no es despliegue productivo ni configuración cloud.

### BL-08 — Quality gates

**Estado:** Implementado para CI técnica.

**Evidencia:** `.github/workflows/ci.yml`.

**Incluye hoy:** `npm ci`, auditoría de dependencias, generación Prisma, typecheck, lint, tests, build y validación Compose.

**Limitación:** no existe CD, promoción automática, preproducción ni prueba de restauración.

### BL-09 — Revisión administrativa de pagos

**Estado:** Implementado para revisión manual y almacenamiento local privado.

**Evidencia:** rol `STORE_ADMIN` en Identity, rutas administrativas de Gateway/Orders y `/admin/payments` en `apps/web`.

**Incluye hoy:** cola de comprobantes, descarga autenticada, aprobación o rechazo, registro de retención/eliminación y resolución de solicitudes de cancelación con constancia de gestión del reembolso externo.

**Limitación:** no procesa pagos ni reembolsos automáticamente; el archivo local requiere almacenamiento persistente y respaldo antes de producción.

## 4. Trabajo P0 pendiente

### P0-01 — Prueba de integración del checkout completo

**Estado:** Implementado.

**Objetivo:** demostrar el flujo autenticado de compra por Gateway, la reserva de Catálogo, la persistencia de Orders y la deduplicación del evento en Notification Worker.

**Evidencia:** `scripts/verify-local-purchase.ps1`, `npm run verify:local-purchase` y ejecución validada contra la stack local.

**Criterios de aceptación:**

- crea un pedido contra el stack local;
- espera la confirmación de reserva y recupera el pedido por `orderId`;
- verifica el mismo `eventId` en notification-worker;
- comprueba que una repetición no duplica la entrega;
- verifica subtotal, envío, total e idempotencia al repetir el mismo checkout;
- cancela el pedido de prueba para liberar su reserva;
- cubre por pruebas automatizadas fallo de notificación y programación de reintento.

**Ownership:** web, gateway, orders-service y notification-worker.

### P0-02 — Validación de precio y disponibilidad

**Estado:** Implementado.

**Objetivo:** impedir que el cliente envíe precios o productos incoherentes con el catálogo vigente.

**Evidencia:** `orders-service/src/catalog.reader.ts`, validación en `OrdersService`, pruebas en `orders.service.test.ts` y `npm run verify:local-purchase` ejecutado contra la stack local.

**Criterios de aceptación:**

- orders-service valida cada producto activo contra catálogo y canonicaliza el nombre de línea;
- el precio persistido se toma de la respuesta autorizada del catálogo;
- stock insuficiente produce rechazo claro;
- Orders persiste reservas y liberaciones como comandos durables e idempotentes;
- existen pruebas de precio manipulado, producto inactivo y stock insuficiente.

**Criterios cerrados:** Catálogo valida y reserva unidades atómicamente; Orders persiste el comando durable de reserva y reintenta errores transitorios sin aceptar sobreventa por lecturas concurrentes.

**Ownership:** catálogo, pedidos y gateway.

### P0-03 — Contrato de error y recuperación de compra

**Estado:** Parcial implementado; persistencia, conflictos y dependencia fuera de línea tienen códigos HTTP diferenciados, y los reintentos no duplican pedidos.

**Objetivo:** que el storefront no confirme falsamente un pedido cuando falla persistencia o notificación.

**Criterios de aceptación:**

- el frontend muestra estado específico para fallo de orders-service;
- el pedido creado con fallo posterior de notificación queda trazable en outbox;
- existe estrategia durable de reintento y deduplicación del evento;
- falta mejorar la presentación de errores específicos del checkout en el storefront.

**Ownership:** gateway, web y worker.

### P0-04 — Identidad mínima de servidor

**Estado:** Implementado.

**Objetivo:** asegurar que pedidos y rutas administrativas se vinculen a una identidad persistente autenticada y autorizada en servidor.

**Criterios de aceptación:**

- Identity mantiene cuentas, hash de contraseña, refresh tokens y rol `CUSTOMER`/`STORE_ADMIN` en su base propia;
- las cookies `httpOnly` mantienen la sesión web y no se guardan tokens en `localStorage`;
- Gateway verifica token y rol con Identity y Orders recibe contexto autenticado solo por su ruta interna protegida;
- solo administradores de tienda pueden acceder a la revisión de pagos.

**Ownership:** Identity, Gateway, web y Orders.

## 5. Objetivos posteriores, fuera del P0 actual

### P1 — Operación comercial pendiente

- adaptador real de notificación y canal WhatsApp aprobado;
- administración de catálogo y gestión comercial de pedidos;
- consulta de pedidos por cliente y fecha;
- promociones, categorías, imágenes, variantes y destacados.

### P2 — Plataforma productiva

- broker externo (el productor ya dispone de outbox transaccional con entrega HTTP);
- observabilidad con métricas, trazas y alertas;
- despliegue cloud, secretos, backups y restore probado;
- threat model, autorización administrativa y auditoría;
- CD y promoción controlada entre entornos.

## 6. Regla de cierre

Una capacidad solo pasa a **Implementado** cuando tiene:

1. código en el workspace dueño;
2. contrato o interfaz verificable;
3. prueba automatizada relevante;
4. smoke o evidencia de runtime si cruza procesos;
5. documentación alineada;
6. limitaciones y rollback conocidos.

El backlog no autoriza crear diagramas, servicios o infraestructura que todavía no tengan una necesidad aprobada y evidencia de implementación.
