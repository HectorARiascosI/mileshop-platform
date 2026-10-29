# Checklist de diagramas y filtros de ingeniería

## Propósito

Este documento controla que la documentación de MileShop describa el sistema real y no una arquitectura genérica. El paquete canónico de diagramas está en [architecture-overview.md](architecture-overview.md).

## Cobertura actual

- [x] contexto del sistema implementado;
- [x] componentes y ownership;
- [x] interfaces HTTP;
- [x] secuencia real de compra;
- [x] modelo de datos Prisma;
- [x] estado actualmente implementado;
- [x] evento y deduplicación;
- [x] despliegue local;
- [x] flujo de navegación de catálogo, registro, carrito y checkout;
- [x] pipeline CI actual;
- [x] matriz de trazabilidad.

## Selección de diagramas para MileShop

| Diagrama de la propuesta | Decisión | Motivo para este proyecto |
| --- | --- | --- |
| Casos de uso UML | Posponer | Solo existe el flujo de cliente; no existe aún administración implementada. |
| Mapa de navegación / user flow | Mantener | Es crítico para registro obligatorio, carrito y checkout. |
| Bloques funcionales | Sustituir por C4 | Componentes y ownership expresan mejor los límites actuales. |
| C4 contexto | Mantener | Define actores, sistema y dependencias reales. |
| DFD | No crear aparte | La secuencia y el modelo de datos cubren el flujo sin duplicarlo. |
| Actividades UML | Mantener después | Útil para errores, validaciones y reintentos del checkout cuando se formalicen. |
| Clases UML | No incluir en arquitectura | Debe vivir cerca del código solo si un dominio alcanza complejidad relevante. |
| DER | Mantener | Es obligatorio para las tres bases Prisma actuales. |
| NoSQL | Eliminar | El proyecto usa PostgreSQL; no hay documentos NoSQL. |
| C4 contenedores | Mantener | Representa web, gateway, servicios, worker y bases. |
| C4 componentes | Mantener | Aclara controllers, dominio, repositorios y stores por servicio. |
| Secuencia UML | Mantener | Es la prueba visual del checkout y `OrderCreated.v1`. |
| Máquina de estados | Mantener | Evita inventar transiciones de pedido no implementadas. |
| Paquetes UML | Posponer | Los boundaries actuales se entienden con workspaces y componentes. |
| Despliegue UML | Mantener local | Docker Compose y los cuatro procesos ya existen. |
| Infraestructura cloud | Posponer | No hay proveedor cloud ni topología aprobada. |
| Redes y seguridad VPC | Posponer | No existe VPC, subredes o firewall productivo definido. |
| DNS | Posponer | No hay dominio ni routing productivo documentado. |
| EDA | Mantener con precisión | Existe `OrderCreated.v1`, pero el transporte actual es HTTP, no Kafka/RabbitMQ. |
| Mapa de contextos DDD | Mantener | Formaliza catálogo, pedidos, notificaciones y web sin inventar servicios. |
| Pipeline CI/CD | Mantener CI | `.github/workflows/ci.yml` ya ejecuta quality gates; CD aún no existe. |
| Observabilidad | Posponer | Solo existen logs y health checks, no plataforma de métricas/tracing. |
| Service mesh | Eliminar | No corresponde a cuatro procesos locales sin Kubernetes ni malla. |

## Paquete mínimo aprobado

El paquete documental de arquitectura queda limitado a:

1. contexto C4;
2. contenedores/componentes y ownership;
3. user flow de checkout;
4. secuencia de compra;
5. DER por base de datos;
6. estados del pedido;
7. evento y deduplicación;
8. despliegue local;
9. CI actual;
10. mapa de contextos DDD.

Los diagramas futuros solo se agregan cuando exista la infraestructura, contrato o código que puedan demostrar.

## Cobertura futura, todavía no cerrada

- [ ] despliegue productivo con infraestructura aprobada;
- [ ] seguridad de identidad, autorización y threat model;
- [ ] observabilidad con métricas, trazas y alertas reales;
- [ ] outbox, broker y recuperación de eventos;
- [ ] dominio de clientes persistente;
- [ ] administración editorial y comercial;
- [ ] promociones, banners, variantes y categorías implementadas;
- [ ] estados avanzados y transiciones del pedido;
- [ ] adaptador operativo de WhatsApp;
- [ ] backup, restore y disaster recovery comprobados.

## Filtros obligatorios

Antes de aceptar un diagrama o documento:

1. Debe señalar el archivo, endpoint, schema, migración, test o script que lo respalda.
2. Debe separar explícitamente `implementado`, `en validación` y `objetivo`.
3. No puede mostrar servicios, tablas, actores o integraciones inexistentes como si fueran actuales.
4. No puede declarar un evento como producido por un servicio distinto al que lo construye hoy.
5. Cada base de datos debe tener un único owner y una migración identificable.
6. Toda secuencia de compra debe representar éxito, fallo de dependencia y duplicación cuando aplique.
7. Los estados dibujados deben existir en el dominio y tener una operación que los produzca.
8. Los diagramas duplicados deben eliminarse o tener responsabilidades documentales distintas.
9. Mermaid debe renderizar sin sintaxis inválida y conservar nombres ASCII para identificadores técnicos.
10. Un diagrama no sustituye una prueba: las afirmaciones críticas deben tener verificación ejecutable.

## Criterio de cierre

La documentación de arquitectura solo se considera cerrada para una capacidad cuando existen simultáneamente:

- diagrama actualizado;
- contrato o interfaz definida;
- implementación correspondiente;
- prueba automatizada o smoke test;
- evidencia de runtime cuando afecta infraestructura;
- decisión de rollback o limitación conocida.

La existencia de un diagrama futuro no autoriza implementar la capacidad ni presentarla como disponible.
