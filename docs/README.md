# Documentación de MileShop Platform

## 1. Propósito de esta carpeta

Esta carpeta es la fuente documentada del proyecto y debe usarse como la referencia de conocimiento operativo del repositorio.

La documentación se divide en 5 capas:

1. Visión general del proyecto
2. Gobernanza y estructura del repositorio
3. Plan de entrega y roadmap
4. Release y operaciones
5. Referencia técnica profunda

## 2. Índice por propósito

### A. Visión general y entrada al repositorio
- [../README.md](../README.md) — presentación del proyecto, estructura y estado general
- [REPOSITORY.md](REPOSITORY.md) — identidad, alcance y reglas de repositorio

### B. Gobierno, flujo de trabajo y calidad
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — reglas de contribución, flujo de ramas y checklist de PR
- [WORKFLOW-2026.md](WORKFLOW-2026.md) — flujo de ingeniería y política de trabajo para 2026; documento canónico del repositorio

### C. Planificación y roadmap de entrega
- [PLAN-V1-2026.md](PLAN-V1-2026.md) — alcance, milestones, Definition of Done y v1.0.0
- [DELIVERY_HISTORY.md](DELIVERY_HISTORY.md) — historial y orden de entregas por ramas

### D. Release, operación y soporte
- [RELEASE-PLAYBOOK.md](RELEASE-PLAYBOOK.md) — flujo de release, hotfix, rollback y promoción a producción
- [STACK_OPERATIONS.md](STACK_OPERATIONS.md) — ownership, runtime map, env vars y diagnósticos de operación
- [LOCAL_STACK_RUNBOOK.md](LOCAL_STACK_RUNBOOK.md) — arranque, health checks y uso local del stack

### E. Referencia técnica profunda
- [wiki/README.md](wiki/README.md) — índice de la wiki técnica
- [wiki/architecture-overview.md](wiki/architecture-overview.md) — arquitectura, dominios y flujo principal
- [wiki/engineering-standards.md](wiki/engineering-standards.md) — estándares SOLID, calidad y proceso de control
- [adr/](adr/) — decisiones de arquitectura formales con contexto, consecuentes y alternatives

## 3. Reglas de uso

- El README del repositorio debe ser la entrada rápida.
- Esta carpeta debe contener la referencia detallada.
- Cada documento debe responder a un propósito específico y no duplicar otra guía general.
- Si un tema cambia, el documento que lo define debe actualizarse, no duplicarse.
- La documentación debe mantenerse estrictamente alineada con el modelo real de MileShop: catálogo, registro, compra, pedido, identidad y notificación.

## 4. Regla de no redundancia y de filtrado

La documentación no se escribe para “llenar espacio”; se escribe para preservar claridad operativa, propiedad del dominio y criterio de entrega.

Reglas obligatorias:

- una decisión de negocio vive en el documento que define el dominio o el proceso; no se replica en varios archivos con el mismo objetivo;
- la rama de documentación no sustituye la evidencia del código ni del flujo operativo;
- cualquier cosa que no se pueda verificar en producto, servicio, contrato o proceso real no entra en la referencia oficial;
- la wiki, los readmes y los playbooks deben mantener la misma base semántica: catálogo, checkout, identidad, pedidos y notificaciones.

Las fuentes canónicas son estas:

- la estructura y el alcance del repositorio viven en [REPOSITORY.md](REPOSITORY.md);
- el gobierno del desarrollo vive en [../CONTRIBUTING.md](../CONTRIBUTING.md) y [WORKFLOW-2026.md](WORKFLOW-2026.md);
- el roadmap y la definición de entregable de la v1 viven en [PLAN-V1-2026.md](PLAN-V1-2026.md);
- el arranque local vive en [LOCAL_STACK_RUNBOOK.md](LOCAL_STACK_RUNBOOK.md);
- la operación del stack vive en [STACK_OPERATIONS.md](STACK_OPERATIONS.md);
- la arquitectura y los flujos reales del negocio viven en [wiki/README.md](wiki/README.md) y sus documentos asociados.

La división es intencional y debe mantenerse así.
