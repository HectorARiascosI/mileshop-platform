# Contribuir a MileShop Platform

## Alcance

Este repositorio contiene la nueva plataforma distribuida de MileShop. El repositorio Django `Proyecto_ventas` es legacy y no debe importarse ni convertirse en una dependencia de los servicios nuevos.

## Flujo de ramas

- `main`: unica rama protegida y siempre desplegable.
- `feat/<dominio>-<cambio>`: funcionalidad nueva.
- `fix/<dominio>-<problema>`: correccion de comportamiento.
- `refactor/<dominio>-<objetivo>`: refactor sin cambio funcional intencional.
- `docs/<tema>`: documentacion.
- `chore/<tema>`: tooling, dependencias o mantenimiento.

Una rama debe tener un objetivo pequeno y una vida corta. No se trabaja directamente sobre `main`.

## Commits

Usamos Conventional Commits:

```text
<tipo>(<alcance>): <descripcion imperativa>
```

Tipos permitidos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, `perf` y `revert`.

Ejemplos:

- `feat(catalog): expose active products endpoint`
- `fix(notifications): deduplicate retried order events`
- `ci(repo): validate every workspace in pull requests`

Cada commit debe ser atomico, compilable y explicar una sola intencion. No se mezclan migraciones, cambios de producto y limpieza no relacionada.

## Pull requests

Toda PR debe incluir:

- problema y criterio de aceptacion;
- servicios, contratos y datos afectados;
- estrategia de migracion y rollback;
- pruebas ejecutadas;
- riesgos operativos y observabilidad;
- impacto de seguridad y privacidad.

No se hace merge si CI falla, si hay vulnerabilidades altas, si falta una migracion versionada o si un servicio cruza el ownership de otro.

## Reglas de arquitectura

- Cada servicio posee su base de datos y sus migraciones.
- No se importan modelos, clientes Prisma ni codigo de otro servicio.
- Las fronteras usan OpenAPI o eventos versionados.
- Los consumidores de eventos son idempotentes.
- Las escrituras distribuidas usan outbox; no se hacen dual writes improvisados.
- Las reglas de negocio viven en casos de uso testeables, no en controladores.
- Los adaptadores externos implementan puertos definidos por la aplicacion.
- SOLID se aplica para reducir acoplamiento y facilitar sustitucion, no para crear capas vacias.

## Verificacion local

Desde la raiz:

```powershell
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --audit-level=high
docker compose -f infra/docker-compose.yml config
```

Las migraciones de cada servicio se aplican con su propia `DATABASE_URL` y nunca contra la base de otro dominio.
