# Contribuir a MileShop Platform

## 1. Alcance

Este repositorio contiene la plataforma distribuida de MileShop. El repositorio legacy `Proyecto_ventas` se conserva solo como referencia histórica y como material de migración, pero no debe mezclarse ni dependerse de él como fuente de verdad del sistema actual.

## 2. Modelo de ramas y flujo 2026

Se utiliza un flujo de ramas claro y protegido:

- `main`: rama de producción, protegida, desplegable y estable.
- `develop`: rama de integración para características validadas y listas para release.
- `feature/<dominio>-<descripcion>`: trabajo nuevo, de una intención concreta.
- `fix/<dominio>-<problema>`: corrección de defectos en una funcionalidad existente.
- `hotfix/<dominio>-<problema>`: corrección urgente para producción.
- `release/<version>`: preparación de un release controlado.
- `docs/<tema>`: documentación.
- `chore/<tema>`: herramientas, dependencias, mantenimiento y tareas operativas.

Reglas:

- No se trabaja directamente en `main` ni en `develop`.
- Todo cambio sale desde una rama corta y específica.
- Las PRs se abren hacia `develop` para cambios de funcionalidad.
- `main` solo recibe cambios a través de `release/*` o `hotfix/*`, siempre con revisión y verificación completa.
- Cada rama debe mantener un objetivo único y medible.

## 3. Política de pull requests

Toda PR debe incluir:

- problema central y criterio de aceptación;
- impacto técnico y de negocio;
- servicios, contratos y basados de datos afectados;
- migraciones, backfill, rollback y estrategia de despliegue;
- casos de prueba ejecutados;
- riesgos, observabilidad y rollback planificado;
- evidencia de CI y build.

Criterios de merge:

- CI verde;
- revisión aprobada por otra persona;
- no hay secretos ni archivos locales sensibles;
- no hay cambios mixtos sin relación;
- no se rompe ownership por dominio ni se cruzan responsabilidades entre servicios.

## 4. Commits

Usamos Conventional Commits:

```text
<tipo>(<alcance>): <descripcion imperativa>
```

Tipos permitidos:

- `feat`: nueva funcionalidad
- `fix`: corrección de bug
- `refactor`: reorganización sin cambio funcional
- `test`: pruebas
- `docs`: documentación
- `chore`: mantenimiento y tooling
- `build`: cambios de compilación o empaquetado
- `ci`: integración continua
- `perf`: rendimiento
- `revert`: reversión de un cambio

Ejemplos:

- `feat(catalog): expose active products endpoint`
- `fix(gateway): handle catalog unavailable with timeout fallback`
- `docs(runtime): document local startup and health checks`
- `ci(repo): enforce quality gates on develop and main`

Regla: cada commit debe resolver una única intención, ser compilable y explicar claramente qué problema resuelve.

## 5. Reglas de arquitectura

- Cada servicio posee su propia base de datos y migraciones.
- No se comparten tablas ni modelos entre dominios.
- Los límites entre servicios usan HTTP o eventos versionados.
- Los consumidores de eventos son idempotentes.
- Los adaptadores externos implementan puertos definidos por la aplicación.
- La lógica de negocio vive en capas testeables y no en controladores anémicos.
- SOLID se aplica para reducir acoplamiento, no para crear capas vacías.
- Los secretos deben ir en variables de entorno y nunca en repositorio.

## 6. Verificación local antes de abrir PR

Desde la raíz del repositorio:

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

Además, por servicio:

```powershell
npm run typecheck --workspace @mileshop/api-gateway
npm run typecheck --workspace @mileshop/catalog-service
npm run typecheck --workspace @mileshop/orders-service
npm run test --workspace @mileshop/api-gateway
npm run test --workspace @mileshop/catalog-service
npm run test --workspace @mileshop/orders-service
```

Las migraciones se aplican con su `DATABASE_URL` del dominio correspondiente y nunca contra la base de otro servicio.

## 7. Flujo recomendado de trabajo

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b feature/catalog-product-list
# trabajo
 git add .
git commit -m "feat(catalog): add product listing"
git push -u origin feature/catalog-product-list
```

Luego:

1. abrir PR hacia `develop`;
2. validar CI;
3. solicitar revisión;
4. hacer merge cuando esté limpio;
5. preparar release desde `develop`.

## 8. Release y promoción a producción

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b release/2026.09.13
git push -u origin release/2026.09.13
```

La rama de release se usa para:

- validar el bundle final;
- ejecutar pruebas de integración y smoke tests;
- documentar riesgo y rollback;
- preparar evidencia de release.

Después, `main` recibe el merge final con revisión y una evidencia clara del cambio.

## 9. Rollback y recuperación

Si un release falla:

1. identificar causa real y evidencia;
2. revert del PR o del merge con trazabilidad;
3. corregir la causa en rama de fix o hotfix;
4. volver a ejecutar validación;
5. promocionar solo con evidencia y sin ambigüedad.

## 10. Principios finales

- no mezclar tipos de trabajo en un mismo commit;
- no hacer merge sin evidencia;
- no trabajar directamente sobre ramas protegidas;
- documentar decisiones operativas con datos y contexto;
- mantener el repositorio legible, reproducible y auditable.
