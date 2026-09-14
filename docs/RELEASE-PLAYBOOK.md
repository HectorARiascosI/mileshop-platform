# Release Playbook MileShop

## 1. Objetivo

Este playbook define el flujo profesional de desarrollo, validación, lanzamiento y recuperación para MileShop en 2026. El objetivo es garantizar que cada cambio sea trazable, revisable, verificable y mantenible.

## 2. Principios de entrega

- cada dominio es propietario de su infraestructura y datos;
- cada cambio pasa por validación de calidad antes de merge;
- no se trabaja directamente sobre `main` ni `develop`;
- cada release se documenta con riesgo, evidencia y rollback;
- los secretos nunca se versionan;
- la trazabilidad debe permitir debuguear un problema en minutos.

## 3. Estructura de ramas

- `main`: producción, ramas protegidas y despliegue autorizado.
- `develop`: integración de características que ya passed CI.
- `feature/<dominio>-<descripcion>`: nueva funcionalidad.
- `fix/<dominio>-<problema>`: corrección continua.
- `hotfix/<dominio>-<problema>`: corrección urgente sobre producción.
- `release/<version>`: preparación de un release estable.

Regla: una rama debe resolver una sola intención y tener una vida corta.

## 4. Flujo correcto de trabajo

### A. Desarrollo

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b feature/catalog-product-list
git add .
git commit -m "feat(catalog): add product listing"
git push -u origin feature/catalog-product-list
```

### B. PR hacia develop

- abrir PR con resumen del problema;
- añadir impacto técnico y de negocio;
- adjuntar resultado de CI;
- documentar migraciones y riesgos;
- no mezclar cambios de documentación, producto y refactor sin necesidad.

### C. Validación antes del merge

```bash
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm run test
npm run build
npm audit --audit-level=high
docker compose -f infra/docker-compose.yml config
```

Si falla cualquiera de estas etapas, la PR no puede mergearse.

## 5. Release flow

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b release/2026.09.13
git push -u origin release/2026.09.13
```

Durante la rama `release/*`:

- ejecutar smoke tests del stack local;
- comprobar health checks y endpoints críticos;
- confirmar documentación actualizada;
- confirmar que no hay artefactos sensibles;
- preparar evidencia para la promoción a `main`.

## 6. Promoción a main

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff release/2026.09.13
git push origin main
```

`main` debe tener evidencia limpia, release validado y revisión aprobada.

## 7. Hotfix flow

```bash
git checkout main
git pull --ff-only origin main
git checkout -b hotfix/gateway-catalog-timeout
git add .
git commit -m "fix(gateway): restore catalog timeout fallback"
git push -u origin hotfix/gateway-catalog-timeout
```

Luego:

- abrir PR hacia `main`;
- validar el escenario exacto que falló;
- backport a `develop` cuando sea apropiado;
- documentar la causa y la corrección.

## 8. Checklists operativos

### Antes de merge

- [ ] build pasa
- [ ] typecheck pasa
- [ ] tests pasan
- [ ] lint pasa
- [ ] auditoría de dependencias pasa
- [ ] docker compose valida
- [ ] no hay secretos ni `.env` en repo
- [ ] documentación refleja el estado real

### Antes de release

- [ ] smoke tests funcionando
- [ ] health checks verdes
- [ ] rollback identificado
- [ ] evidencia de validación guardada
- [ ] ownership por dominio conservado

## 9. Rollback y recuperación

Si un cambio rompe producción:

1. aislar la causa con evidencia real;
2. revert del merge o PR;
3. preparar fix en rama corta;
4. ejecutar validación nuevamente;
5. re-promocionar solo cuando el sistema esté estable.

## 10. Mantenibilidad

Un repositorio profesional debe ser:

- claro en su estructura;
- auditable en su historial;
- reproducible en sus validaciones;
- seguro en su tratamiento de secretos;
- rápido para diagnósticar fallos.

La trazabilidad no es burocracia: es cómo se evita perder el contexto de una caída o un defecto.
