# Infraestructura local

El compose local levanta la base PostgreSQL exclusiva de `notification-worker` en el puerto `5433`.

```powershell
docker compose -f infra/docker-compose.yml up -d notification-postgres
```

Despues, desde `services/notification-worker`:

```powershell
$env:DATABASE_URL = "postgresql://notifications:notifications@localhost:5433/notifications"
npm run db:generate
npx prisma migrate dev --schema prisma/schema.prisma --name initial
```

Cada servicio nuevo tendra su propia base y compose o recurso administrado; no se compartiran tablas entre dominios.
