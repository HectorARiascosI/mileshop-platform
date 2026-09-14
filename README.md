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
- [docs/DELIVERY_HISTORY.md](docs/DELIVERY_HISTORY.md) — orden de entregas, commits y dependencias entre ramas.
- [docs/PLAN-V1-2026.md](docs/PLAN-V1-2026.md) — plan objetivo, milestones y Definition of Done de la primera version estable.
- [docs/RELEASE-PLAYBOOK.md](docs/RELEASE-PLAYBOOK.md) — flujo de release, hotfix, rollback y promocion a produccion.
- [docs/wiki/README.md](docs/wiki/README.md) — wiki operativa del proyecto: arquitectura, calidad, release y sostenimiento.
- [docs/adr/](docs/adr/) — decisiones de arquitectura con consecuencias, validacion y rollback.
- [SECURITY.md](SECURITY.md) — secretos, dependencias y reportes de seguridad.
- `.github/workflows/ci.yml` — auditoria, typecheck, lint, tests, build y Compose.

## Reglas

- Cada servicio sera dueño de su base de datos.
- Ningun servicio consultara tablas de otro servicio.
- La comunicacion sera HTTP mediante contratos OpenAPI o eventos versionados.
- Los eventos tendran idempotencia y outbox transaccional.
- La migracion desde Django se hara por strangler, con reconciliacion y rollback.

## Estado

El frontend, `api-gateway`, `notification-worker`, `catalog-service` y `orders-service` compilan y tienen pruebas. El gateway expone `/healthz`, `/catalog/products` y `/orders`, y consulta el catálogo mediante HTTP con timeout y manejo de indisponibilidad. Los servicios con persistencia tienen PostgreSQL propio, migraciones Prisma y health checks.

La primera version estable de la plataforma no se etiqueta ni se considera cerrada hasta cumplir el plan contenido en [docs/PLAN-V1-2026.md](docs/PLAN-V1-2026.md), que incluye alcance, milestones, calidad, preproduccion, pruebas unitarias e integracion, versionado semantico y evidencia de release.

## Version 1.0.0

La etiqueta formal `v1.0.0` solo se crea cuando se cumpla el Definition of Done de [docs/PLAN-V1-2026.md](docs/PLAN-V1-2026.md), incluyendo:

- `develop` estable y validada;
- release branch validada en CI;
- pruebas unitarias, de integracion y de entorno completadas;
- smoke tests y health checks en preproduccion o entorno equivalente;
- rollback y observabilidad documentados;
- versionado semantico y changelog de entrega.

## Documentacion operativa

La wiki del proyecto se mantiene en [docs/wiki/README.md](docs/wiki/README.md). Esta se usa para:

- arquitectura general del sistema;
- decisiones de diseño y normas de ingeniería;
- procedimientos de release y operacion;
- guias para mantener el proyecto en el tiempo sin depender de la memoria del autor.
