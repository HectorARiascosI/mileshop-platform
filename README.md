# MileShop Platform

Nueva plataforma distribuida para MileShop. El repositorio Django anterior se conserva como referencia legacy y fuente temporal de migracion; no se importa codigo desde el.

## Estructura

- `apps/web` — frontend Next.js + TypeScript.
- `packages/contracts` — contratos de eventos y APIs versionados.
- `services/` — servicios desplegables de forma independiente.
- `services/api-gateway` — entrada HTTP pública y composición de APIs.
- `infra/` — PostgreSQL local y configuracion reproducible.

## Gobernanza

- [CONTRIBUTING.md](CONTRIBUTING.md) — ramas, commits, PRs y reglas SOLID.
- [docs/REPOSITORY.md](docs/REPOSITORY.md) — alcance, repositorios y criterios de separacion.
- [SECURITY.md](SECURITY.md) — secretos, dependencias y reportes de seguridad.
- `.github/workflows/ci.yml` — auditoria, typecheck, lint, tests, build y Compose.

## Reglas

- Cada servicio sera dueño de su base de datos.
- Ningun servicio consultara tablas de otro servicio.
- La comunicacion sera HTTP mediante contratos OpenAPI o eventos versionados.
- Los eventos tendran idempotencia y outbox transaccional.
- La migracion desde Django se hara por strangler, con reconciliacion y rollback.

## Estado

El frontend, `api-gateway`, `notification-worker` y `catalog-service` compilan y tienen pruebas. El gateway expone `/healthz` y `/catalog/products`, y consulta el catálogo mediante HTTP con timeout y manejo de indisponibilidad. Los servicios con persistencia tienen PostgreSQL propio, migraciones Prisma y health checks. El siguiente slice es carrito, seguido por pedidos. La infraestructura se añade por servicio y no se comparten tablas entre dominios.
