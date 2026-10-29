# ADR 0005: Servicio de Identidad y Autenticación

- Estado: Aprobado
- Fecha: 2026-10-14
- Alcance: `services/identity-service`, `services/api-gateway`, `apps/web`

## Contexto

No existe dominio de identidad persistente. El `customerId` es un string libre derivado del correo en `localStorage`. BL-03 y P0-04 del backlog exigen resolver esto. El `customerId` que llega al servicio de pedidos proviene del cliente sin verificación de servidor; cualquier consumidor puede enviar un identificador arbitrario.

## Decision

Se crea `services/identity-service` como bounded context de identidad con PostgreSQL propio en `:5436`.

- Autenticación mediante JWT HS256 con expiración de 15 minutos.
- Refresh token opaco con expiración de 30 días almacenado en la base de datos del servicio.
- Hash de contraseñas con `bcryptjs`.
- `jsonwebtoken` directo, sin `@nestjs/jwt` ni `passport`.
- El API gateway protege `POST /orders` con `AuthMiddleware` que delega la verificación del token al servicio de identidad.
- El frontend utiliza `httpOnly cookies` gestionadas mediante API routes de Next.js; no se almacena ningún token en `localStorage`.

## Operacion local

Ver `STACK_OPERATIONS.md` sección _Identity service_.

```powershell
$env:DATABASE_URL = "postgresql://identity:identity@localhost:5436/identity?schema=public"
docker compose -f infra/docker-compose.yml up -d --wait identity-postgres
npm run db:deploy --workspace @mileshop/identity-service
```

## Consecuencias

- Los tokens no se almacenan en `localStorage`.
- El `customerId` que llega al servicio de pedidos está verificado por el servidor.
- Se añade `identity-postgres` como quinta base de datos del stack local.

## Alternativas consideradas

- `@nestjs/passport`: rechazado por agregar una dependencia sin ventaja real en este contexto.
- Auth0 o servicio externo: rechazado por ausencia de presupuesto y por generar dependencia externa en la fase inicial.

## Rollback

1. Revertir `AppModule` del gateway: eliminar `AuthMiddleware` y la variable de entorno `IDENTITY_SERVICE_URL`.
2. Restaurar la lectura de `customerId` desde `localStorage` en `catalog-shell.tsx`.
3. Eliminar el contenedor `identity-postgres` del Compose y la entrada correspondiente en los scripts de stack local.
