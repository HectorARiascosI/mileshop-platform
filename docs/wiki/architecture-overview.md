# Arquitectura de MileShop Platform

## 1. Regla de lectura

Este documento describe primero el estado implementado y verificable en el repositorio. Todo elemento marcado como `objetivo` es diseño pendiente y no debe interpretarse como una capacidad disponible.

La fuente de evidencia es:

- `apps/web` para storefront, carrito, login, registro y checkout;
- `services/api-gateway` para la entrada HTTP pública y la composición;
- `services/identity-service` para autenticación, sesión y perfiles de cliente;
- `services/catalog-service` para productos y stock;
- `services/orders-service` para la persistencia y las reglas del pedido;
- `services/notification-worker` para deduplicación y procesamiento de `OrderCreated.v1`;
- los schemas Prisma y las migraciones de cada servicio para el modelo de datos;
- los scripts de `scripts/` para el runtime local.

## 2. Estado implementado

### 2.1 Contexto del sistema

```mermaid
flowchart LR
    Customer[Cliente registrado] --> Web[apps/web\nNext.js storefront]
    Web --> Gateway[API Gateway\n:3000]
    Gateway --> Identity[Identity Service\n:3040]
    Gateway --> Catalog[Catalog Service\n:3020]
    Gateway --> Orders[Orders Service\n:3030]
    Orders --> Worker[Notification Worker\n:3010]
    Identity --> IdentityDb[(Identity PostgreSQL\n:5436)]
    Catalog --> CatalogDb[(Catalog PostgreSQL\n:5434)]
    Orders --> OrdersDb[(Orders PostgreSQL\n:5435)]
    Worker --> NotificationDb[(Notifications PostgreSQL\n:5433)]
```

No existe actualmente un panel administrativo ni un adaptador de WhatsApp en este monorepo.

### 2.1.1 Mapa de contextos DDD actual

```mermaid
flowchart LR
    Customer[Cliente autenticado\ncontexto de identidad]
    IdentityCtx[Identidad\nautenticación y sesión]
    CatalogCtx[Catálogo\nproductos y stock]
    OrdersCtx[Pedidos\nvalidación, total, persistencia y outbox]
    NotificationCtx[Notificaciones\neventId y entrega]

    Customer -->|registro y login| IdentityCtx
    Customer -->|consulta y checkout| CatalogCtx
    Customer -->|customerId verificado + líneas| OrdersCtx
    IdentityCtx -->|verifica token JWT| OrdersCtx
    OrdersCtx -->|OrderCreated.v1 por HTTP desde outbox| NotificationCtx
    OrdersCtx -.->|productId y snapshot de línea| CatalogCtx
```

La relación punteada entre catálogo y pedidos no es una lectura directa: el pedido almacena un snapshot de los datos recibidos. El `customerId` que llega al servicio de pedidos está verificado por el servidor mediante `AuthMiddleware` en el gateway.

### 2.2 Componentes y ownership

```mermaid
flowchart TB
    Web[apps/web]
    Gateway[api-gateway]
    Identity[identity-service]
    Catalog[catalog-service]
    Orders[orders-service]
    Worker[notification-worker]
    Contracts[packages/contracts]
    IdentityDb[(Customer + RefreshToken)]
    CatalogDb[(Product)]
    OrdersDb[(Order + OrderLine + OrderEventOutbox)]
    NotificationDb[(NotificationDelivery)]

    Web -->|POST /auth/register\nPOST /auth/login\nGET /catalog/products\nPOST /orders| Gateway
    Gateway -->|POST /auth/register\nPOST /auth/login\nPOST /auth/refresh\nPOST /auth/logout\nGET /auth/me\nPOST /auth/verify-token| Identity
    Gateway -->|GET /products| Catalog
    Gateway -->|POST /orders\nGET /orders/:orderId| Orders
    Orders -->|POST /events/order-created| Worker
    Web -.-> Contracts
    Identity --> IdentityDb
    Catalog --> CatalogDb
    Orders --> OrdersDb
    Worker --> NotificationDb
```

Ownership actual:

| Área | Responsable | Evidencia |
| --- | --- | --- |
| Identidad y sesión | `identity-service` | `services/identity-service/prisma/schema.prisma` |
| Productos activos | `catalog-service` | `services/catalog-service/prisma/schema.prisma` |
| Pedido, líneas y evento outbox | `orders-service` | `services/orders-service/prisma/schema.prisma` |
| Entrega idempotente con lease | `notification-worker` | `NotificationDelivery` y `eventId` único |
| Composición pública | `api-gateway` | `gateway.controller.ts` y `orders.service.ts` |
| Checkout y autenticación web | `apps/web` | `catalog-shell.tsx`, `login/page.tsx` y `register/page.tsx` |

### 2.3 Interfaces HTTP implementadas

| Servicio | Endpoint | Resultado |
| --- | --- | --- |
| Gateway | `GET /healthz` | estado del gateway |
| Gateway | `GET /catalog/products` | catálogo activo compuesto desde catálogo |
| Gateway | `POST /orders` | valida JWT, exige `Idempotency-Key` y delega la creación |
| Gateway | `POST /auth/register` | proxy hacia identity-service, crea cuenta |
| Gateway | `POST /auth/login` | proxy hacia identity-service, devuelve tokens |
| Gateway | `POST /auth/refresh` | proxy hacia identity-service, renueva access token |
| Gateway | `POST /auth/logout` | proxy hacia identity-service, invalida refresh token |
| Gateway | `GET /auth/me` | proxy hacia identity-service, perfil del cliente autenticado |
| Identity | `GET /healthz` | estado del servicio de identidad |
| Identity | `POST /auth/register` | crea CUSTOMER con contraseña hasheada |
| Identity | `POST /auth/login` | valida credenciales, emite JWT + refresh token |
| Identity | `POST /auth/refresh` | valida refresh token opaco, emite nuevo JWT |
| Identity | `POST /auth/logout` | invalida refresh token en DB |
| Identity | `GET /auth/me` | retorna perfil del cliente desde JWT |
| Identity | `POST /auth/verify-token` | verifica JWT y retorna payload (uso interno del gateway) |
| Catalog | `GET /healthz` | estado del catálogo |
| Catalog | `GET /products` | productos activos ordenados por nombre |
| Orders | `GET /healthz` | estado de pedidos |
| Orders | `POST /orders` | valida, calcula subtotal/envío/total y persiste pedido + outbox |
| Orders | `GET /orders/:orderId` | recupera pedido y líneas |
| Worker | `GET /healthz` | estado de notificaciones |
| Worker | `POST /events/order-created` | reclama con lease, deduplica y procesa el evento |

### 2.3.1 Flujo de navegación implementado

```mermaid
flowchart LR
    Login[Login] --> Catalog[Catálogo]
    Register[Registro] --> Catalog
    Catalog --> Cart[Carrito]
    Cart --> Checkout[Confirmar pedido]
    Checkout --> Success[Confirmación]
    Checkout -->|sin sesión activa| Login
    Checkout -->|carrito vacío| Cart
    Login -->|sin cuenta| Register
```

Este es el flujo de cliente que existe hoy en `apps/web`. No se dibuja un flujo administrativo porque todavía no existe `Admin Console` en este proyecto.

### 2.4 Secuencia real de compra

```mermaid
sequenceDiagram
    participant C as Cliente
    participant W as Web
    participant G as API Gateway :3000
    participant ID as Identity :3040
    participant CAT as Catalog :3020
    participant ORD as Orders :3030
    participant N as Worker :3010
    participant ODB as Orders DB
    participant NDB as Notifications DB

    C->>W: abre catálogo
    W->>G: GET /catalog/products
    G->>CAT: GET /products
    CAT-->>G: productos activos
    G-->>W: catálogo
    C->>W: login o registro
    W->>G: POST /auth/login
    G->>ID: POST /auth/login
    ID-->>G: JWT (15 min) + refresh token
    G-->>W: httpOnly cookie con tokens
    C->>W: confirma carrito
    W->>G: POST /orders (Authorization: Bearer JWT)
    G->>ID: POST /auth/verify-token
    ID-->>G: payload del token verificado
    G->>ORD: POST /orders (customerId verificado)
    ORD->>CAT: GET /products\nvalida identidad, precio y stock
    CAT-->>ORD: producto activo y disponibilidad
    ORD->>ORD: valida payload y calcula subtotal, envío y total
    ORD->>ODB: transacción: pedido, líneas y OrderEventOutbox PENDING
    ORD->>ODB: reclama evento con lease y token
    ORD->>N: POST /events/order-created
    alt worker envía o ya había enviado
        N->>NDB: crea o reclama eventId con lease
        N->>NDB: envía y marca SENT
        N-->>ORD: sent o duplicate
        ORD->>ODB: marca evento PUBLISHED
    else worker ocupado, indisponible o timeout
        N-->>ORD: 202 processing o error
        ORD->>ODB: libera claim y agenda reintento con backoff
    end
    ORD-->>G: pedido persistido
    G-->>W: orderId, total y evento
    opt repetición del mismo checkout
        W->>G: POST /orders con el mismo Idempotency-Key
        G->>ID: verifica token
        G->>ORD: reenvía comando autenticado
        ORD->>ODB: busca cliente + clave
        ODB-->>ORD: pedido original
        ORD-->>G: devuelve pedido sin crear otro evento
        G-->>W: mismo orderId
    end
```

La clave de idempotencia se conserva en `sessionStorage` durante reintentos del mismo carrito. `orders-service` guarda pedido, líneas y evento en la misma transacción; si no se entrega la notificación, la compra sigue creada y el outbox reintenta con backoff. Los leases evitan que dos instancias procesen simultáneamente la misma reclamación. La entrega es al menos una vez, por lo que `notification-worker` deduplica por `eventId`.

### 2.5 Modelo de datos implementado

```mermaid
erDiagram
    CUSTOMER {
        string id PK
        string email UK
        string name
        string phone
        string passwordHash
        datetime createdAt
        datetime updatedAt
    }
    REFRESH_TOKEN {
        string id PK
        string token UK
        string customerId FK
        boolean revoked
        datetime expiresAt
        datetime createdAt
    }
    PRODUCT {
        string id PK
        string sku UK
        string name
        string description
        int priceCop
        int stock
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }
    ORDER {
        string id PK
        string orderId UK
        string customerId
        string idempotencyKey
        string requestFingerprint
        int subtotalCop
        int deliveryFeeCop
        int totalCop
        string status
        datetime createdAt
        datetime updatedAt
    }
    ORDER_LINE {
        string id PK
        string productId
        string sku
        string name
        int quantity
        int unitPriceCop
        string orderId FK
    }
    NOTIFICATION_DELIVERY {
        string id PK
        string eventId UK
        enum status
        int attempts
        string claimToken
        datetime leaseExpiresAt
        string lastError
        datetime processedAt
        datetime createdAt
        datetime updatedAt
    }
    ORDER_EVENT_OUTBOX {
        string eventId PK
        string eventType
        string aggregateId
        json payload
        enum status
        int attemptCount
        datetime nextAttemptAt
        string claimToken
        datetime leaseExpiresAt
    }
    CUSTOMER ||--|{ REFRESH_TOKEN : has
    ORDER ||--|{ ORDER_LINE : contains
```

`productId` en `OrderLine` es una referencia de negocio almacenada como snapshot; no existe foreign key entre la base de catálogo y la base de pedidos. `CUSTOMER` y `REFRESH_TOKEN` pertenecen a la base de datos de identidad (`:5436`), aislada de las demás. No hay tablas implementadas para direcciones, promociones, banners, variantes o administradores.

### 2.6 Estado del pedido implementado

```mermaid
stateDiagram-v2
    [*] --> PENDING: createOrder válido
    PENDING --> [*]: lectura actual
```

El schema permite texto libre y el dominio tipa `PENDING`, `CONFIRMED` y `CANCELLED`, pero todavía no existen endpoints ni transiciones implementadas para confirmar o cancelar. Estados adicionales como `READY_FOR_DISPATCH` y `COMPLETED` son objetivo, no comportamiento actual.

### 2.7 Evento `OrderCreated.v1`

```mermaid
flowchart LR
    Persisted[Pedido + evento confirmados en transacción] --> Pending[Outbox PENDING]
    Pending --> Claim[claimToken + lease]
    Claim --> Worker[Notification Worker por HTTP]
    Worker --> Sent[NotificationDelivery SENT]
    Worker --> Active[202 PROCESSING]
    Worker --> Failed[fallo de entrega]
    Active --> Retry[reintento al expirar lease]
    Failed --> Backoff[backoff exponencial]
    Backoff --> Pending
    Claim --> Published[Outbox PUBLISHED]
```

El evento se construye y persiste en `services/orders-service`. El worker deduplica mediante `NotificationDelivery.eventId` y evita reclamar de nuevo mientras exista un lease vigente. El transporte sigue siendo HTTP; no se utiliza un broker externo.

### 2.8 Despliegue local

```mermaid
flowchart TB
    Docker[Docker Desktop]
    Docker --> CDB[(catalog-postgres :5434)]
    Docker --> NDB[(notification-postgres :5433)]
    Docker --> ODB[(orders-postgres :5435)]
    Docker --> IDB[(identity-postgres :5436)]
    Start[scripts/start-local-stack.ps1] -->|migraciones| CDB
    Start -->|migraciones| NDB
    Start -->|migraciones| ODB
    Start -->|migraciones| IDB
    Start -->|procesos independientes| Apps[Gateway + Identity + Catalog + Orders + Worker]
    Apps --> CDB
    Apps --> NDB
    Apps --> ODB
    Apps --> IDB
```

El script inicia migraciones, lanza procesos independientes con logs en `.local-stack/logs`, espera los cinco `/healthz` y ejecuta el smoke test del catálogo. `scripts/stop-local-stack.ps1` detiene listeners y Postgres.

### 2.9 Pipeline de CI implementado

```mermaid
flowchart LR
    Change[push o pull request\nmain / develop] --> Install[npm ci]
    Install --> Audit[npm audit --audit-level=high]
    Audit --> Generate[npm run db:generate]
    Generate --> Typecheck[npm run typecheck]
    Typecheck --> Lint[npm run lint]
    Lint --> Test[npm run test]
    Test --> Build[npm run build]
    Build --> Compose[docker compose config]
    Compose --> Stack[Compose + migraciones + seed]
    Stack --> Smoke[servicios + compra autenticada + deduplicación]
    Smoke --> Green[release-quality verde]
```

La pipeline real está en `.github/workflows/ci.yml`. Además de calidad y compilación, levanta una stack efímera y verifica el flujo de compra autenticado con un cliente sintético. No despliega a cloud ni promueve automáticamente una release.

## 3. Diseño objetivo pendiente

Estos elementos pertenecen al producto planificado y no deben aparecer en los diagramas de estado actual hasta que exista código, schema, contrato y prueba:

- panel administrativo y ownership editorial;
- promociones, banners, notas, categorías y variantes;
- estados avanzados del pedido y sus transiciones;
- adaptador real de WhatsApp;
- broker externo (el productor ya dispone de outbox transaccional y usa HTTP);
- despliegue remoto, observabilidad y backup productivos.

## 4. Matriz de trazabilidad documental

| Diagrama | Pregunta que responde | Evidencia requerida |
| --- | --- | --- |
| Contexto | ¿Qué existe alrededor del sistema? | workspaces y runtime |
| Componentes | ¿Quién posee cada responsabilidad? | módulos, controllers y Prisma |
| Interfaces | ¿Qué contratos HTTP existen? | controllers y clientes |
| Secuencia | ¿Qué ocurre en una compra? | web, gateway, orders y worker |
| Datos | ¿Qué tablas y relaciones existen? | `schema.prisma` y migraciones |
| Estados | ¿Qué transiciones están implementadas? | dominio, endpoints y tests |
| Evento | ¿Cómo se deduplica una notificación? | contrato, worker y store |
| Despliegue | ¿Cómo se ejecuta localmente? | Docker Compose y scripts |

Un diagrama que no pueda apuntar a una de estas evidencias se marca como objetivo o se elimina.
