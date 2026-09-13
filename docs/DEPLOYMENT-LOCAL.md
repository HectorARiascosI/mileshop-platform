# Despliegue local MileShop

## 1. Requisitos

- Node.js 20+
- npm 10+
- Docker Desktop o Docker Engine con soporte de PostgreSQL
- GitHub CLI configurado para el repositorio

## 2. Instalación

```bash
cd mileshop-platform
npm install
```

## 3. Generar clientes Prisma

```bash
npm run db:generate
```

## 4. Levantar bases de datos

```bash
docker compose -f infra/docker-compose.yml up -d notification-postgres catalog-postgres orders-postgres
```

## 5. Ejecutar servicios

### API Gateway

```bash
cd services/api-gateway
$env:PORT = "3000"
$env:CATALOG_SERVICE_URL = "http://127.0.0.1:3020"
npm start
```

### Catalog Service

```bash
cd services/catalog-service
$env:DATABASE_URL = "postgresql://catalog:catalog@localhost:5434/catalog?schema=public"
$env:PORT = "3020"
npm start
```

### Orders Service

```bash
cd services/orders-service
$env:DATABASE_URL = "postgresql://orders:orders@localhost:5435/orders?schema=public"
$env:PORT = "3030"
$env:ALLOWED_ORIGINS = "http://localhost:3000"
$env:RATE_LIMIT_MAX = "120"
npm start
```

### Notification Worker

```bash
cd services/notification-worker
$env:DATABASE_URL = "postgresql://notifications:notifications@localhost:5433/notifications?schema=public"
$env:PORT = "3010"
npm start
```

## 6. Validación de entorno

```bash
curl http://localhost:3000/healthz
curl http://localhost:3020/healthz
curl http://localhost:3030/healthz
```

## 7. Migraciones

Para cada servicio con Prisma:

```bash
npm run db:deploy --workspace @mileshop/orders-service
npm run db:deploy --workspace @mileshop/catalog-service
npm run db:deploy --workspace @mileshop/notification-worker
```

## 8. Seguridad

- nunca versionar archivos `.env` reales
- mantener secretos fuera del repositorio
- limitar CORS a dominios conocidos
- revisar logs y health checks antes de publicar
