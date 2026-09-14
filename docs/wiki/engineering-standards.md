# Estándares de ingeniería

## 1. Objetivo

Este documento define los estándares mínimos que debe cumplir cualquier cambio en MileShop Platform para ser considerado profesional, sostenible y seguro.

## 2. Principios SOLID aplicados

### SRP — Single Responsibility Principle
Cada módulo debe tener una razón clara para existir.

Ejemplo en este repositorio:
- frontend para experiencia del usuario;
- gateway para composición;
- orders service para dominio de pedido;
- catalog service para catálogo;
- notification worker para eventos y envío.

### OCP — Open/Closed Principle
El comportamiento debe abrirse por extensión y cerrarse por modificación innecesaria.

Ejemplo:
- cambios de integración deben pasar por contratos y adaptadores, no por reescrituras agresivas del flujo principal.

### LSP — Liskov Substitution Principle
Las implementaciones de interfaces o contratos deben respetar el comportamiento esperado.

### ISP — Interface Segregation Principle
No forzar dependencias grandes cuando una pieza solo necesita una parte específica del contrato.

### DIP — Dependency Inversion Principle
Las capas superiores no deben depender de detalles concretos. Deben depender de abstracciones.

## 3. Criterios de calidad mínimos

Cada cambio debe pasar estas verificaciones:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
``` 

Además, cuando aplique:

```powershell
docker compose -f infra/docker-compose.yml config
```

## 4. Política de ramas

```text
main
└── develop
    ├── feature/<dominio>-<objetivo>
    ├── fix/<dominio>-<problema>
    ├── hotfix/<dominio>-<urgencia>
    └── release/<version>
```

Reglas:
- `main` no se toca directamente;
- `develop` acumula cambios ya validados;
- `feature/*` resuelve una sola intención;
- `fix/*` cubre defectos reales;
- `hotfix/*` es de emergencia sobre producción;
- `release/*` valida la promoción final a producción.

## 5. Política de PR

Todo PR debe incluir:

- problema que resuelve;
- alcance exacto;
- pruebas ejecutadas;
- riesgos y mitigación;
- rollback previsto;
- evidencia técnica relevante.

## 6. Estándar de commits

Se recomienda seguir Conventional Commits:

- `feat(...)`
- `fix(...)`
- `refactor(...)`
- `docs(...)`
- `test(...)`
- `chore(...)`

Ejemplo:

```bash
git commit -m "feat(catalog): add catalog product listing"
```

## 7. Estrategia de testing

### Unit tests
Validan reglas de negocio y unidades pequeñas.

### Integration tests
Validan la colaboración entre componentes y servicios.

### Smoke tests
Validan el flujo principal del sistema en un entorno realista.

### Contract tests
Validan la compatibilidad entre productor y consumidor de eventos o APIs.

## 8. Definición de hecho de un cambio listo

Un cambio solo está listo cuando:

- compila;
- pasa typecheck;
- pasa lint;
- pasa los tests relevantes;
- cumple con el alcance acordado;
- se documenta si impacta arquitectura, operación o release;
- no deja dependencia humana para entenderlo.

## 9. Mantenimiento de documentación

Si un cambio afecta:

- arquitectura;
- proceso operativo;
- release;
- seguridad;
- flujo de negocio;

entonces debe reflejarse en la documentación y no quedar solo en el código.

## 10. Conclusión

El código y la operación deben comportarse como un sistema pensado para sostenerse en el tiempo. La calidad no es un lujo; es la base para que el proyecto pueda crecer sin volverse frágil.
