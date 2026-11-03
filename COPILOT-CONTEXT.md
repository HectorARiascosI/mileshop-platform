# MileShop Platform — Contexto completo para GitHub Copilot

## QUIÉN ERES Y QUÉ ESTÁS HACIENDO

Eres un ingeniero senior trabajando en **MileShop Platform**, un e-commerce para un negocio familiar colombiano (Pasto, Nariño) que vende productos físicos. El objetivo es construir una plataforma de comercio digital moderna, bien estructurada y escalable desde cero, migrando desde un proyecto legacy Django mal estructurado.

---

## LO QUE TIENES QUE LEER PRIMERO (en este orden)

### Documentación del negocio
1. `docs/wiki/business-requirements.md` — actores, historias de usuario, reglas de negocio, entidades
2. `docs/wiki/architecture-overview.md` — arquitectura implementada con diagramas Mermaid
3. `docs/wiki/product-backlog-v1.md` — estado actual de cada capacidad (Implementado/Parcial/Pendiente)
4. `docs/PLAN-V1-2026.md` — milestones y Definition of Done de v1.0.0
5. `docs/wiki/engineering-standards.md` — principios SOLID, quality gates, patrones obligatorios
6. `docs/WORKFLOW-2026.md` — flujo de ramas, commits, PRs

### ADRs (decisiones de arquitectura)
7. `docs/adr/0001-plataforma-distribuida.md`
8. `docs/adr/0002-api-gateway.md`
9. `docs/adr/0003-storefront-web.md`
10. `docs/adr/0004-catalog-persistence.md`
11. `docs/adr/0005-identity-service.md` ← recién creado

### Código fuente existente — leer en este orden
12. `packages/contracts/src/index.ts` — contrato OrderCreatedV1
13. `services/api-gateway/src/` — todos los archivos
14. `services/catalog-service/src/` + `prisma/schema.prisma`
15. `services/orders-service/src/` + `prisma/schema.prisma`
16. `services/notification-worker/src/` + `prisma/schema.prisma`
17. `services/identity-service/src/` + `prisma/schema.prisma` ← recién creado
18. `apps/web/src/` — todos los archivos
19. `infra/docker-compose.yml`
20. `package.json` raíz (workspaces)
21. `.github/workflows/ci.yml`

### Proyecto legacy para referencia visual
22. `../Proyecto_ventas/productos/templates/productos/base.html` — navbar, footer, estructura
23. `../Proyecto_ventas/productos/templates/productos/index.html` — homepage con productos
24. `../Proyecto_ventas/productos/static/productos/css/styles.css` — tema cyberpunk neon completo
25. `../Proyecto_ventas/productos/templates/productos/carrito.html`
26. `../Proyecto_ventas/productos/templates/productos/pedido_confirmado.html`
27. `../Proyecto_ventas/productos/templates/productos/login.html`
28. `../Proyecto_ventas/productos/templates/productos/registro.html`

---

## EL PROYECTO EN UNA FRASE

Monorepo npm workspaces con Next.js 16 (storefront) + 5 servicios NestJS + Fastify (api-gateway, catalog-service, orders-service, notification-worker, identity-service) + 4 bases PostgreSQL independientes (Prisma 6.12) + CI en GitHub Actions.

---

## STACK TÉCNICO (EXACTO, NO CAMBIAR)

| Tecnología | Versión | Dónde |
|---|---|---|
| Node.js | 24 | Todo |
| TypeScript | 5.9, strict, ES2022 NodeNext | Todo |
| Next.js | 16.3.5, App Router | apps/web |
| NestJS | 12 | Todos los servicios |
| Fastify | 5 | Todos los servicios (via @nestjs/platform-fastify) |
| Prisma | 6.12.0 | catalog, orders, notification, identity |
| Zod | v4 | Validación en servicios |
| node:test | built-in | Test runner (NO jest, NO vitest) |
| npm workspaces | 11 | Monorepo |
| PostgreSQL | 17-alpine | Docker local |
| Tailwind | v4 (CSS-first) | apps/web |

---

## ESTRUCTURA DEL MONOREPO

```
mileshop-platform/
├── apps/
│   └── web/                          # Next.js 16 storefront
│       └── src/
│           ├── app/
│           │   ├── layout.tsx         # Root layout
│           │   ├── page.tsx           # Homepage (Server Component)
│           │   ├── globals.css        # Estilos globales (Tailwind v4 CSS-first)
│           │   ├── checkout/page.tsx  # Confirmación pedido
│           │   ├── login/page.tsx     # Login ← recién creado
│           │   ├── register/page.tsx  # Registro
│           │   ├── profile/page.tsx   # Perfil ← pendiente
│           │   └── api/
│           │       └── auth/
│           │           ├── register/route.ts  ← recién creado
│           │           ├── login/route.ts     ← recién creado
│           │           ├── logout/route.ts    ← recién creado
│           │           └── me/route.ts        ← recién creado
│           ├── components/
│           │   └── catalog-shell.tsx  # Componente principal del storefront
│           └── lib/
│               ├── cart.ts            # Funciones puras del carrito
│               ├── cart.test.ts
│               ├── order.ts           # Helpers de pedido
│               └── order.test.ts
│
├── services/
│   ├── api-gateway/      :3000  # Entrada HTTP pública
│   ├── catalog-service/  :3020  # Catálogo + PostgreSQL :5434
│   ├── orders-service/   :3030  # Pedidos + PostgreSQL :5435
│   ├── notification-worker/ :3010  # Notificaciones + PostgreSQL :5433
│   └── identity-service/ :3040  # Auth JWT + PostgreSQL :5436 ← recién creado
│
├── packages/
│   └── contracts/        # @mileshop/contracts — OrderCreatedV1
│
├── infra/
│   └── docker-compose.yml  # 4 PostgreSQL (5433, 5434, 5435, 5436)
│
├── scripts/               # PowerShell: start/stop/status/deploy-db/verify-purchase
└── docs/                  # Wiki, ADRs, plan, runbooks
```

---

## PATRONES DE ARQUITECTURA OBLIGATORIOS

Estos patrones están en TODOS los servicios y debes respetarlos exactamente:

### 1. Repository Pattern
```typescript
// Interfaz pura
export interface CustomerRepository {
  findByEmail(email: string): Promise<CustomerRecord | null>;
  save(customer: CustomerRecord): Promise<void>;
}

// InMemory para tests (sin BD real)
export class InMemoryCustomerRepository implements CustomerRepository { ... }

// Prisma para producción
export class PrismaCustomerRepository implements CustomerRepository { ... }
```

### 2. Dependency Inversion con tokens NestJS (string tokens)
```typescript
// En app.module.ts — strategy: Prisma si DATABASE_URL, InMemory si no
{
  provide: "CUSTOMER_REPOSITORY",
  useFactory: (prisma) => {
    if (process.env.DATABASE_URL) return new PrismaCustomerRepository(prisma);
    return new InMemoryCustomerRepository();
  },
  inject: ["PRISMA_CLIENT"],
}
```

### 3. Thin Controllers — sin lógica de negocio
```typescript
@Post("auth/register")
async register(@Body() body: unknown) {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return this.service.register(parsed.data);
}
```

### 4. Application Service con reglas de dominio
```typescript
async register(command: RegisterCommand): Promise<AuthResult> {
  const existing = await this.repo.findByEmail(command.email);
  if (existing) throw new ConflictException("Email already registered");
  // toda la lógica aquí
}
```

### 5. Tests con node:test — NO jest, NO vitest, NO describe/it/expect
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";

test("registro exitoso devuelve tokens", async () => {
  const result = await service.register({ email: "a@b.com", password: "12345678", name: "Test" });
  assert.ok(result.accessToken);
});
```

### 6. Zod v4 para validación
```typescript
import { z } from "zod";
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(3),
});
```

### 7. Conventional Commits
```
feat(identity): add JWT refresh token rotation
fix(orders): use crypto.randomUUID() for orderId generation
docs(adr): document identity service architecture decision
test(gateway): add AuthMiddleware unit tests
```

### 8. Ramas desde develop
```
fix/orders-critical-bugs
feature/identity-service
feature/gateway-identity-integration
feature/web-auth-flow
feature/web-complete-ui    ← LA QUE FALTA
docs/identity-and-auth
```

---

## LO QUE YA ESTÁ IMPLEMENTADO Y FUNCIONA

### ✅ Catálogo activo
- `catalog-service` con Prisma, seed idempotente, `GET /products`
- 4 productos: MILE-MUG-001, MILE-BAG-001, MILE-NOTE-001, MILE-BTL-001

### ✅ Carrito (frontend)
- `apps/web/src/lib/cart.ts` — funciones puras, inmutables
- Persistencia en `localStorage` (`mileshop-cart-v1`)
- Subtotal, envío (8%, mínimo $12.000 COP), gratis sobre $150.000 COP

### ✅ Creación de pedido
- `orders-service` valida precio y stock contra catálogo en tiempo real
- `orders-service` calcula y persiste subtotal, envío y total; el estado inicial es `PENDING`
- `Idempotency-Key` UUID permite recuperar el pedido original al repetir una solicitud
- `orderId` tiene formato UUID con prefijo `order-`
- 404 correcto en `GET /orders/:orderId` cuando no existe

### ✅ Deduplicación de notificaciones
- `notification-worker` con `NotificationDelivery.eventId @unique`
- `orders-service` persiste `OrderEventOutbox` y reintenta entregas fallidas hasta ocho intentos
- la creación del pedido y la inserción en la outbox todavía no son atómicas
- ⚠️ `LoggingNotificationSender` es un stub — solo `console.info`, no envía WhatsApp real

### ✅ Identity Service (recién implementado — rama feature/identity-service)
- `services/identity-service/` NestJS + Fastify :3040, PostgreSQL :5436
- Modelos: `Customer` + `RefreshToken`
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- JWT HS256 con `jsonwebtoken` (sin @nestjs/jwt), bcryptjs (sin bcrypt nativo)
- 8 tests con node:test

### ✅ Auth Middleware en Gateway (rama feature/gateway-identity-integration)
- `auth.middleware.ts` verifica Bearer token llamando `GET /auth/me`
- `POST /orders` y `GET /orders/:orderId` protegidos; el `customerId` viene de la identidad verificada
- `POST /orders` requiere `Idempotency-Key`; el gateway oculta pedidos que pertenecen a otro cliente

### ✅ API Routes de Auth en Web (rama feature/web-auth-flow)
- `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me`
- `/api/orders` crea pedidos y `/api/orders/:orderId` consulta el estado desde el server-side proxy
- Tokens en **httpOnly cookies**

---

## LO QUE FALTA — PRIORIDAD ACTUAL

### 🔴 feature/web-complete-ui — Rediseño completo del frontend

El frontend actual es minimalista y NO tiene el diseño del legacy. Hay que implementar:

#### DISEÑO CYBERPUNK NEON (replicar del legacy exactamente)

**Paleta:**
```css
--neon-pink: #ff006e;
--neon-pink-glow: rgba(255, 0, 110, 0.8);
--neon-purple: #8b5cf6;
--neon-blue: #06b6d4;
--dark-bg: #0a0a0a;
--dark-card: rgba(20, 20, 20, 0.8);
--glass-border: rgba(255, 0, 110, 0.3);
--success: #10b981;
--danger: #ef4444;
--warning: #f59e0b;
```

**Body:**
- `background: linear-gradient(135deg, #0a0a0a 0%, #1a0a1a 50%, #0a0a0a 100%) fixed`
- `::before` — grid neon: `linear-gradient(rgba(255,0,110,0.05) 1px, transparent 1px)` cada 50px
- `::after` — radial glows en esquinas
- Font: Inter (Google Fonts)

**Navbar:**
- `rgba(10,10,10,0.9)`, backdrop-filter blur(20px)
- border-bottom 2px neon pink + box-shadow glow
- Logo "MileShop" uppercase neon pink con text-shadow glow
- Links: Inicio, Carrito (badge neon pink con cantidad)
- Si autenticado: dropdown "Mi Perfil", "Mis Pedidos", "Cerrar Sesión"
- Si no: "Iniciar Sesión", "Registrarse"
- Hamburger responsive

**Cards glassmorphism:**
- `background: rgba(30,30,30,0.95)`
- `border: 2px solid rgba(255,0,110,0.3)`
- `box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(255,0,110,0.8)`
- Hover: `translateY(-10px)` + border neon pink + glow intenso
- Imagen: height 250px, object-fit cover, hover `scale(1.1) brightness(1)`

**Botones:**
- `border: 2px solid`, uppercase, letter-spacing 1px
- Ripple `::before`: círculo rgba blanco que expande en hover
- Primary: borde neon pink, fondo transparente → fondo neon pink en hover + glow
- Success: verde. Danger: rojo.

**Footer 3 columnas:**
1. "Sobre Nosotros" + botones sociales circulares (Facebook, Instagram, WhatsApp, Messenger)
   - Facebook: `https://www.facebook.com/profile.php?id=61571396736734`
   - Instagram: `https://www.instagram.com/mileshop_col/`
   - WhatsApp: `https://wa.me/573206594057`
   - Messenger: `https://m.me/61571396736734`
2. "Enlaces Rápidos"
3. "Contacto":
   - Pasto, Nariño, Colombia
   - +57 320 659 4057
   - Socorro Milena Insuasty Ortiz
   - milenainsu@gmail.com

**Toast notifications:**
- Bottom-right, slide-in desde derecha, auto-dismiss 5s
- success=verde, error=rojo, info=azul, warning=amarillo

**Botón flotante carrito:**
- Circular neon pink, badge cantidad, hover scale+rotate

**Scrollbar neon pink**

#### ARCHIVOS A IMPLEMENTAR

**`apps/web/src/app/globals.css`** — Reescribir completamente con todo el tema neon. CSS puro, NO clases Tailwind para el visual.

**`apps/web/src/app/layout.tsx`** — Agregar preconnect + link a Inter, metadata correcta.

**`apps/web/src/components/catalog-shell.tsx`** — Reescribir completo:
- Navbar con dropdown auth
- Hero: "Lo que necesitas, sin complicaciones."
- Grid productos: imagen placeholder neon si no hay URL, precio COP formateado, estrellas, control +/- cantidad, botón agregar con loading state
- Panel carrito lateral slide-in con resumen y confirmar pedido
- Sección features: Envío Coordinado, Compra Segura, Soporte WhatsApp
- Footer completo
- Sistema de toasts
- Botón flotante carrito
- Verificar auth en checkout llamando `GET /api/auth/me`

**`apps/web/src/app/login/page.tsx`** — Rediseño neon:
- Icono circular pulse, título uppercase neon pink
- Toggle mostrar/ocultar contraseña
- Llama `POST /api/auth/login`

**`apps/web/src/app/register/page.tsx`** — Rediseño neon:
- Barra fortaleza contraseña (rojo→amarillo→verde según: length≥8, mayús, minus, números, especiales)
- Llama `POST /api/auth/register`

**`apps/web/src/app/checkout/page.tsx`** — Rediseño neon:
- Animación checkmark circular verde (CSS puro)
- Sección WhatsApp con fondo verde semitransparente
- Botón pulse "Enviar por WhatsApp" con URL dinámica: `https://wa.me/573206594057?text=Hola, mi pedido #${orderId} por $${total}`

**`apps/web/src/app/profile/page.tsx`** — Nuevo:
- Verificar auth, redirect a `/login` si no
- Avatar con inicial del nombre
- Mostrar datos del usuario

#### REGLAS TÉCNICAS PARA EL FRONTEND
- TypeScript strict — sin `any`
- `"use client"` solo donde haya estado/eventos — Server Components donde sea posible
- NO Bootstrap, NO jQuery — CSS puro + React
- Precios: `new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(price)`
- Imágenes: si no hay URL real, placeholder CSS con gradiente neon y nombre del producto
- Mantener lógica existente de `cart.ts` y `order.ts` sin cambios
- Respetar integración de auth (API routes `/api/auth/*`)
- Reemplazar `window.alert()` con el sistema de toasts

---

## VARIABLES DE ENTORNO POR SERVICIO

```powershell
# api-gateway :3000
PORT=3000
CATALOG_SERVICE_URL=http://127.0.0.1:3020
ORDERS_SERVICE_URL=http://127.0.0.1:3030
IDENTITY_SERVICE_URL=http://127.0.0.1:3040
ALLOWED_ORIGINS=http://localhost:3001

# catalog-service :3020
DATABASE_URL=postgresql://catalog:catalog@localhost:5434/catalog?schema=public

# orders-service :3030
CATALOG_SERVICE_URL=http://127.0.0.1:3020
NOTIFICATION_WORKER_URL=http://127.0.0.1:3010
DATABASE_URL=postgresql://orders:orders@localhost:5435/orders?schema=public

# notification-worker :3010
DATABASE_URL=postgresql://notifications:notifications@localhost:5433/notifications?schema=public

# identity-service :3040
DATABASE_URL=postgresql://identity:identity@localhost:5436/identity?schema=public
JWT_SECRET=<minimo-32-chars>
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=30

# apps/web (.env.local)
API_GATEWAY_URL=http://localhost:3000   # sin NEXT_PUBLIC — solo server-side
```

---

## CÓMO LEVANTAR EL STACK

```powershell
# Desde C:\Users\hecto\OneDrive\Desktop\ProyectosEnProceso\MileShop\mileshop-platform
.\scripts\start-local-stack.ps1

# Web (terminal separada)
cd apps\web && npm run dev

# Detener todo
.\scripts\stop-local-stack.ps1
```

---

## QUALITY GATES

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --audit-level=high
docker compose -f infra/docker-compose.yml config
```

---

## REGLAS QUE NO SE NEGOCIAN

1. Cada servicio es dueño de su BD — nadie consulta tablas ajenas
2. Contratos entre servicios: HTTP + eventos versionados (`OrderCreated.v1`)
3. Monorepo con ramas `feature/` desde `develop` — nada directo a main
4. **node:test** como test runner — sin jest, sin vitest, sin describe/it/expect
5. **Zod v4** para validación — no class-validator
6. Sin `@nestjs/jwt` ni `@nestjs/passport` — JWT directo con `jsonwebtoken`
7. **bcryptjs** (puro JS) — no bcrypt nativo
8. TypeScript strict — sin `any`
9. Commits atómicos Conventional Commits — una intención por commit
10. La documentación se actualiza con el código

---

## CONTEXTO DEL NEGOCIO

- **Nombre**: MileShop
- **Propietaria**: Socorro Milena Insuasty Ortiz
- **Ubicación**: Pasto, Nariño, Colombia
- **Modelo**: Tienda física, venta por pedido, atención por WhatsApp
- **Envío**: 8% del subtotal, mínimo $12.000 COP, gratis sobre $150.000 COP
- **Estado**: Negocio familiar hoy, plataforma diseñada para escalar
- **Infraestructura objetivo**: Free tiers — Vercel (web), Railway/Render (servicios), Supabase (PostgreSQL)
- **Legacy archivado**: `../Proyecto_ventas` — Django, NO se toca
