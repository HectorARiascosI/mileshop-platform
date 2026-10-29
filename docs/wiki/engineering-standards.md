# Estándares de ingeniería

## 1. Objetivo

Este documento define el estándar técnico mínimo que debe cumplir cualquier cambio en MileShop Platform para ser considerado profesional, sostenible, verificable y seguro.

No se busca un conjunto de buenas prácticas genéricas. El objetivo es dejar claro cómo se construye software real en este proyecto, especialmente teniendo en cuenta un negocio de catálogo, registro de clientes, ventas por pedido y gestión editorial.

## 2. Principios de diseño aplicados

### SRP — Single Responsibility Principle
Cada módulo debe tener una razón clara para existir.

En este repositorio se aplica así:

- web para experiencia del cliente y administración;
- gateway para composición y coordinación;
- catalog service para catálogo y merchandising;
- orders service para dominio de pedido y regla comercial;
- notification worker para eventos y notificaciones externas;
- admin y publicaciones para gestión operativa del contenido.

### OCP — Open/Closed Principle
El sistema debe poder extenderse sin reescribir principios centrales.

Ejemplo: si se agrega una nueva fuente de notificación o un nuevo tipo de promoción, la lógica central no debe reescribirse por cada variante.

### LSP — Liskov Substitution Principle
Los contratos y adaptadores deben respetar las expectativas de los consumidores.

### ISP — Interface Segregation Principle
No forzar a un componente a depender de interfaces o datos que no usa.

### DIP — Dependency Inversion Principle
La capa superior no debe depender de la implementación concreta de otra capa.

## 3. Arquitectura de calidad

### 3.1 Ownership de dominio
Cada servicio debe ser dueño de sus datos y decisiones.

- catalog owns catalog;
- orders owns order lifecycle;
- users owns identity and customer data;
- notification owns outbound communication.

### 3.2 Bounded context
No se debe mezclar la lógica de negocio de distintos dominios en una sola capa.

### 3.3 Contratos explícitos
Toda integración debe pasar por un contrato claro, versionado y testeado.

### 3.4 Idempotencia
Los eventos, reintentos y notificaciones deben ser seguros frente a duplicidad.

### 3.5 Observabilidad
Todos los flujos críticos deben tener trazabilidad suficiente para diagnóstico, revisión y soporte.

## 4. Criterios de calidad obligatorios

Cada cambio debe pasar la validación mínima del repositorio antes de ser considerado listo:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

Cuando sea relevante, además:

```powershell
docker compose -f infra/docker-compose.yml config
```

## 5. Reglas de entrega

Un cambio solo se considera entregable si:

- compila sin errores;
- pasa typecheck;
- pasa tests relevantes;
- cumple con el alcance acordado;
- tiene riesgo documentado;
- tiene rollback claro cuando aplica;
- no depende de conocimiento informal del autor para entenderse;
- no mezcla trabajo de varios dominios en un mismo commit o PR.

## 6. Política de ramas

```text
main
└── develop
    ├── feature/<dominio>-<objetivo>
    ├── fix/<dominio>-<problema>
    ├── hotfix/<dominio>-<urgencia>
    └── release/<version>
```

Reglas:

- `main` es producción final y protegida;
- `develop` es integración y validación;
- `feature/*` debe resolver una intención única;
- `fix/*` corrige un problema real y medible;
- `hotfix/*` es para emergencia en producción;
- `release/*` valida la entrega final antes de `main`;
- no se trabaja directamente sobre ramas protegidas.

## 7. Política de pull request

Cada PR debe responder estas preguntas:

- ¿qué problema resuelve?
- ¿cuál es el criterio de aceptación?
- ¿qué dominios y servicios impactan?
- ¿qué riesgo o dependencia hay?
- ¿qué pruebas ejecutaste?
- ¿qué rollback o mitigación existe?
- ¿qué documentación cambia como consecuencia?

Si una PR no responde esto, no está lista para revisión.

## 8. Estándar de commits

Se usa Conventional Commits.

Ejemplos:

- `feat(catalog): add product listing with active pricing`
- `fix(order): validate required customer data before checkout`
- `docs(wiki): document catalog merchandising and admin flow`
- `test(notifications): add idempotency retry validation`
- `refactor(gateway): isolate catalog and order call composition`

## 9. Testing strategy

### Unit tests
Valida reglas específicas y lógica mínima.

### Integration tests
Valida la colaboración real entre componentes, servicios y contratos.

### Contract tests
Valida que producer y consumer de APIs o eventos mantienen compatibilidad.

### Smoke tests
Valida el flujo principal del negocio en un entorno realista.

### Testing de negocio
Debe comprobar reglas críticas del negocio, como:

- cliente registrado antes de compra;
- precios visibles acordes al catálogo;
- pedido se crea con contexto del usuario;
- notificación enviada con datos suficientes;
- estado del pedido cambia con trazabilidad.

## 10. Reglas de negocio que deben estar cubiertas por pruebas

Estas no son opcionales y deben ser parte del criterio de calidad:

- un cliente sin registro no puede completar compra;
- un pedido sin líneas válidas es rechazado;
- una promoción o descuento debe aplicarse en el contexto correcto;
- la notificación debe contener datos relevantes del cliente;
- una compra debe dejarnos trazabilidad del evento y del pedido;
- un producto no visible o no activo no debe publicarse en el catálogo.

## 11. Mantenimiento de documentación

Si un cambio modifica:

- arquitectura;
- reglas del negocio;
- contratos de servicio;
- flujo de compra;
- administración de contenido;
- release o rollback;
- seguridad de datos;

entonces debe actualizarse la documentación correspondiente y no quedar sólo en la memoria del desarrollador.

## 12. Criterio de excelencia para este proyecto

Para MileShop Platform, el estándar “bueno” no es solo “funciona en local”.

El estándar correcto es:

- se entiende el flujo real del negocio;
- cada dominio tiene ownership;
- cada servicio se valida por sí mismo;
- cada entrega tiene evidencia;
- cada cambio puede ser revisado, medido y revertido.

## 13. Conclusión

La ingeniería de software en este proyecto debe comportarse como un sistema construido para sostenerse. La calidad no es decoración; es la base para que la plataforma pueda crecer de forma segura, operable y auditable.

En un negocio como este, que combina catálogo, venta, administración editorial y atención por WhatsApp, la disciplina técnica es la diferencia entre una demo y un sistema comercial serio.
