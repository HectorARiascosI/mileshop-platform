# Workflow 2026 para MileShop Platform

## 1. Objetivo

Este documento formaliza el flujo de trabajo de ingeniería para 2026 en MileShop. El objetivo no es seguir una receta genérica, sino mantener un repositorio profesional, auditable, reproducible y seguro.

## 2. Principios

- la rama principal no se toca directamente;
- cada cambio tiene un alcance claro;
- cada PR debe documentar riesgo y evidencia;
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

## 4. Reglas operativas

### Desarrollo

1. iniciar desde `develop`;
2. crear rama corta con nombre consistente;
3. trabajar en una intención concreta;
4. commit atómico y descriptivo;
5. levantar PR con evidencia y riesgo;
6. merge solo con CI verde.

### Integración

- `develop` recibe cambios ya validados;
- `develop` debe permanecer estable;
- todas las PRs se revisan antes del merge;
- no se aceptan cambios de alcance mezclado.

### Producción

- `main` recibe releases y hotfixes validados;
- no haya merges directos sin evidencia;
- cada release se documenta con rollback y observabilidad.

## 5. Validación requerida antes de merge

Antes de cualquier merge, el repositorio debe demostrar lo siguiente:

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

Es imprescindible que cada una de estas etapas se ejecute en el contexto correcto del monorepo.

## 6. Política de PR

Todo PR debe responder:

- ¿Qué problema resuelve?
- ¿Qué criterios de aceptación cumplen?
- ¿Qué servicios se ven afectados?
- ¿Qué migración o rollback requiere?
- ¿Qué pruebas se ejecutaron?
- ¿Qué riesgos quedan?

## 7. Notas de seguridad

- nunca subir secretos obligatorios;
- no versionar `.env` ni tokens de acceso;
- tener un procedimiento claro para rotar secretos;
- revisar dependencias y vulnerabilidades con `npm audit`.

## 8. Mantenibilidad

El repositorio debe permitir:

- entender qué se cambió y por qué;
- reproducir un entorno con un comando;
- diagnosticar fallos con trazabilidad;
- revertir un cambio sin riesgo oculto.

## 9. Recomendación para este repositorio

Para este proyecto, el flujo correcto es:

- `feature/*` para cambios de producto y servicio;
- `fix/*` para defectos confirmados;
- `hotfix/*` solo para producción;
- `release/*` para promoción de `develop` a `main`;
- `develop` como integración y `main` como estabilidad final.

## 10. Enfoque de 2026

El estándar de 2026 exige más que “funciona en local”. Exige que el código sea:

- revisable;
- verificable;
- documentado;
- seguro;
- operativo;
- mantenible para años.

Esta es la diferencia entre un proyecto improvisado y un sistema preparado para crecer.
