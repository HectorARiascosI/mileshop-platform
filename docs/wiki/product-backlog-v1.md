# Backlog v1 de MileShop Platform

## 1. Regla de alcance

Este backlog distingue el runtime demostrado de las capacidades pendientes. Ningún item se considera terminado por tener documentación: necesita código, prueba y evidencia de ejecución cuando corresponda.

La v1 actual está construida alrededor de cuatro procesos ejecutables: storefront web, API Gateway, Catalog Service, Orders Service y Notification Worker. `Proyecto_ventas` es legacy y no forma parte de este backlog.

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

**Limitación:** el carrito no consulta stock nuevamente antes de confirmar y no existe reserva de inventario.

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
- devuelve estado inicial `PENDING` y `orderId` único.

**Limitación:** valida precio, identidad de línea y stock observado contra el catálogo activo, pero todavía no reserva ni decrementa stock y no tiene transiciones de estado operativas. La lectura de stock no evita sobreventa en compras concurrentes.

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

**Estado:** Implementado para desarrollo local.

**Evidencia:** `infra/docker-compose.yml`, migraciones Prisma, `start-local-stack.ps1`, `status-local-stack.ps1`, `stop-local-stack.ps1` y runbook.

**Incluye hoy:** cuatro PostgreSQL, migraciones automáticas, cinco procesos independientes, health checks y smoke test de catálogo.

**Limitación:** no es un despliegue productivo ni una configuración cloud.

### BL-08 — Quality gates

**Estado:** Implementado para CI técnica.

**Evidencia:** `.github/workflows/ci.yml`.

**Incluye hoy:** `npm ci`, auditoría de dependencias, generación Prisma, typecheck, lint, tests, build y validación Compose.

**Limitación:** no existe CD, promoción automática, preproducción ni prueba de restauración.

## 4. Trabajo P0 pendiente

### P0-01 — Prueba de integración del checkout completo

**Estado:** Implementado.

**Objetivo:** demostrar en una sola prueba el flujo storefront/contexto local → gateway → orders-service → worker.

**Evidencia:** `scripts/verify-local-purchase.ps1`, `npm run verify:local-purchase` y ejecución validada contra la stack local.

**Criterios de aceptación:**

- crea un pedido contra el stack local;
- recupera el pedido por `orderId`;
- verifica el mismo `eventId` en notification-worker;
- comprueba que una repetición no duplica la entrega;
- verifica subtotal, envío, total e idempotencia al repetir el mismo checkout;
- cubre por pruebas automatizadas fallo de notificación y programación de reintento.

**Ownership:** web, gateway, orders-service y notification-worker.

### P0-02 — Validación de precio y disponibilidad

**Estado:** Parcial implementado.

**Objetivo:** impedir que el cliente envíe precios o productos incoherentes con el catálogo vigente.

**Evidencia:** `orders-service/src/catalog.reader.ts`, validación en `OrdersService`, pruebas en `orders.service.test.ts` y `npm run verify:local-purchase` ejecutado contra la stack local.

**Criterios de aceptación:**

- orders-service valida cada producto activo contra catálogo y canonicaliza el nombre de línea;
- el precio persistido se toma de la respuesta autorizada del catálogo;
- stock insuficiente produce rechazo claro;
- la decisión de reserva o decremento de stock queda documentada;
- existen pruebas de precio manipulado, producto inactivo y stock insuficiente.

**Pendiente para cerrar:** reserva o decremento transaccional de stock; actualmente solo se valida la disponibilidad observada.

**Ownership:** catálogo, pedidos y gateway; requiere decidir el contrato de consulta.

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

**Objetivo:** decidir si la v1 acepta contexto local o exige identidad persistente real.

**Criterios de aceptación:**

- decisión documentada por negocio y seguridad;
- si se exige identidad, existe customer model, endpoint y almacenamiento propio;
- el pedido referencia una identidad validada por servidor;
- se eliminan claims de “registro” si solo existe `localStorage`.

**Ownership:** identidad, gateway, web y pedidos. Es una decisión de release, no una mejora cosmética.

## 5. Objetivos posteriores, fuera del P0 actual

### P1 — Operación comercial

- adaptador real de notificación y canal WhatsApp aprobado;
- panel administrativo para catálogo y pedidos;
- consulta de pedidos por cliente y fecha;
- transiciones de estado con permisos y auditoría;
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
