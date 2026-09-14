# Workflow 2026 para MileShop Platform

## 1. Objetivo

Este documento define el flujo profesional de ingeniería para MileShop en 2026. El objetivo es mantener un repositorio auditable, reproducible, seguro y fácil de diagnosticar.

## 2. Principios base

- no se trabaja directamente sobre ramas protegidas;
- cada cambio tiene alcance claro;
- cada PR debe incluir riesgo y evidencia;
- cada release debe poder revertirse;
- cada servicio tiene ownership y pruebas propias;
- la documentación refleja el estado real del sistema.

## 3. Estructura de ramas

```text
main
└── develop
    ├── feature/catalog-product-list
    ├── fix/gateway-timeout
    ├── release/2026.09.13
    └── hotfix/urgent-prod-fix
```

## 4. Política de ramas

### Flujo estándar

- `main`: rama de producción, protegida y desplegable.
- `develop`: integración de funcionalidades validadas.
- `feature/*`: nueva funcionalidad.
- `fix/*`: corrección de defectos.
- `hotfix/*`: corrección urgente en producción.
- `release/*`: validación final antes de producción.

Reglas:

- nunca se trabaja directamente sobre `main` o `develop`;
- se usan ramas cortas con una sola meta;
- todos los merges pasan por pull request con revisión;
- la producción solo avanza con evidencia validada.

## 5. Requisitos de PR

Cada PR debe responder:

- qué problema resuelve;
- qué criterios de aceptación cumplen;
- qué servicios, contratos o bases de datos se afectan;
- qué migraciones, backups o rollback existen;
- qué pruebas se ejecutaron;
- qué riesgos quedan después del cambio.

El merge solo es válido si:

- CI está verde;
- hay aprobación de revisión;
- no hay secretos ni artefactos locales;
- el alcance se mantiene disciplinado y atómico.

## 6. Convenciones de commits

Se usa Conventional Commits:

```text
<tipo>(<alcance>): <descripción>
```

Tipos permitidos:

- `feat`
- `fix`
- `refactor`
- `test`
- `docs`
- `chore`
- `build`
- `ci`
- `perf`
- `revert`

Ejemplos:

- `feat(catalog): expose active products endpoint`
- `fix(gateway): restore catalog timeout fallback`
- `docs(runtime): document local startup and health checks`
- `ci(repo): enforce quality gates on develop and main`

## 7. Validación obligatoria antes del merge

Una rama no está lista para merge hasta que pase todo esto:

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

Este paso debe ejecutarse desde la raíz del monorepo y cualquier fallo bloquea el merge.

## 8. Flujo de release

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b release/2026.09.13
git push -u origin release/2026.09.13
```

La rama `release/*` sirve para:

- validación final en un contexto controlado;
- smoke tests y validación de healthchecks;
- planificación de rollback y evidencia;
- promoción a producción con trazabilidad.

## 9. Promoción a producción

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff release/2026.09.13
git push origin main
```

Este proceso solo aplica con revisión y evidencia del release validado.

## 10. Proceso de hotfix

```bash
git checkout main
git pull --ff-only origin main
git checkout -b hotfix/gateway-catalog-timeout
git add .
git commit -m "fix(gateway): restore catalog timeout fallback"
git push -u origin hotfix/gateway-catalog-timeout
```

El hotfix debe ser mínimo, probado y luego backportado a `develop` cuando corresponde.

## 11. Mantenibilidad operativa

Un repositorio profesional debe permitir responder sin ambigüedad:

- qué cambió;
- por qué cambió;
- cómo fue validado;
- cómo revertirlo;
- dónde está la responsabilidad en caso de fallo.

Eso es lo que separa un prototipo improvisado de un sistema que está listo para crecer con calidad.
