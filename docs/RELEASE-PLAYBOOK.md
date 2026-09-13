# Release Playbook MileShop

## 1. Objetivo

Este playbook define el flujo de trabajo profesional para desarrollar, validar, empujar y fusionar cambios en MileShop sin dejar huecos de calidad, seguridad o reproducibilidad.

## 2. Principios de entrega

- Cada dominio es propietario de su infraestructura: catálogo, notificaciones y pedidos no comparten tablas ni esquemas.
- Cada cambio debe pasar validación de tests, typecheck y build antes del merge.
- No se usan secretos en repositorio ni archivos `.env` con credenciales reales.
- Todo release debe ser verificable con comandos reproducibles desde la raíz del monorepo.

## 3. Ramas recomendadas

- `main`: rama de producción.
- `develop`: integración de características.
- `feature/<nombre>`: trabajo de funcionalidad.
- `hotfix/<nombre>`: corrección urgente.

Regla: no hacer push directo a `main` ni a `develop` sin revisión.

## 4. Antes de abrir el PR

Ejecutar desde la raíz del repo:

```bash
npm install
npm run db:generate
npm test --workspace @mileshop/orders-service
npm run typecheck --workspace @mileshop/orders-service
npm run build --workspace @mileshop/orders-service
npm test --workspace @mileshop/api-gateway
npm run typecheck --workspace @mileshop/api-gateway
npm run build --workspace @mileshop/api-gateway
```

Además:

- validar que el cambio no deja `.env` ni credenciales reales en el repo
- confirmar que el service ownership sigue correcto por dominio
- revisar que la documentación refleja el comportamiento real y no un starter genérico

## 5. Revisión y merge

Flujo recomendado:

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b feature/<nombre>
# trabajo
 git add .
git commit -m "feat(scope): descripcion del cambio"
git push -u origin feature/<nombre>
```

Luego crear PR con:

- resumen del negocio afectado
- impacto técnico
- pruebas ejecutadas
- riesgo y rollback
- documentación actualizada

Requisitos para merge:

- revisión aprobada por al menos una persona
- checks verdes
- sin secretos ni artefactos locales
- evidencia de pruebas adjunta

## 6. Merge a main

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff develop
git push origin main
```

Solo usar merge directo cuando se haya validado el release completo y no haya riesgo de regresión.

## 7. Seguridad

- usar variables de entorno y never hardcodearlas
- mantener .env fuera del control de versiones
- revisar `npm audit --audit-level=high` antes de release
- no subir dumps de base de datos, conexiones locales ni archivos generados sensibles

## 8. Rollback

Si un release falla:

1. revert del merge / PR
2. reestabilizar rama de release
3. confirmar origen del problema
4. volver a ejecutar validación de la rama corregida
5. relanzar con evidencia limpia

## 9. Checklist final de release

- [ ] tests pasan
- [ ] typecheck pasa
- [ ] build pasa
- [ ] migraciones Prisma están definidas y reproducibles
- [ ] no hay secretos ni `.env` versionados
- [ ] seguridad HTTP y CORS revisados
- [ ] documentación actualizada para el cambio
- [ ] PR con resumen de negocio y riesgo
- [ ] merge ejecutado con historial claro
