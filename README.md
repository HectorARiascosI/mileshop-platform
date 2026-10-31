# MileShop Platform

Nueva plataforma distribuida para MileShop. El repositorio Django anterior se conserva como referencia legacy y fuente temporal de migracion; no se importa codigo desde el.

## Estructura

- `apps/web` — frontend Next.js + TypeScript.
- `packages/contracts` — contrato de evento compartido; los contratos HTTP actuales viven en los controllers y clientes de cada servicio.
- `services/` — servicios desplegables de forma independiente.
- `services/api-gateway` — entrada HTTP pública y composición de APIs.
- `infra/` — PostgreSQL local y configuracion reproducible.

## Gobernanza

- [CONTRIBUTING.md](CONTRIBUTING.md) — ramas, commits, PRs y reglas SOLID.
- [docs/REPOSITORY.md](docs/REPOSITORY.md) — alcance, repositorios y criterios de separacion.
- [docs/DELIVERY_HISTORY.md](docs/DELIVERY_HISTORY.md) — orden de entregas, commits y dependencias entre ramas.
- [docs/PLAN-V1-2026.md](docs/PLAN-V1-2026.md) — plan objetivo, milestones y Definition of Done de la primera version estable.
- [docs/RELEASE-PLAYBOOK.md](docs/RELEASE-PLAYBOOK.md) — flujo de release, hotfix, rollback y promocion a produccion.
- [docs/wiki/README.md](docs/wiki/README.md) — wiki operativa del proyecto: arquitectura, calidad y sostenimiento técnico.
- [docs/adr/](docs/adr/) — decisiones de arquitectura con consecuencias, validacion y rollback.
- [SECURITY.md](SECURITY.md) — secretos, dependencias y reportes de seguridad.
- `.github/workflows/ci.yml` — auditoria, typecheck, lint, tests, build y Compose.

## Reglas

- Cada servicio sera dueño de su base de datos.
- Ningun servicio consultara tablas de otro servicio.
- La comunicación entre los servicios implementados usa HTTP; `OrderCreated.v1` es el evento versionado actual.
- `orders-service` es la fuente de verdad para subtotal, tarifa de entrega y total; el storefront solo muestra una estimación previa. La tarifa es COP 12.000 o 8 % del subtotal, lo que sea mayor, y el envío es gratis desde COP 150.000.
- La creación de pedido requiere `Idempotency-Key`; el checkout reutiliza la clave al reintentar y consulta el estado desde el pedido persistido.
- El worker implementa deduplicación por `eventId`; `orders-service` persiste un outbox con reintentos exponenciales. La escritura atómica pedido/outbox y un broker siguen pendientes.
- La migración desde Django es una estrategia futura; todavía no hay cortes de tráfico ni reconciliación automatizada implementados.
- El alcance del repositorio se define por negocio real del proyecto y no por experimentos o ideas no priorizadas.
- La documentacion es fuente de verdad para decisiones de producto, arquitectura y operacion; no se duplica ni se repite sin necesidad.

## Filtros de calidad y alcance

Este repositorio aplica un criterio estricto:

- no se admite trabajo genérico o de plantilla sin ligadura directa a MileShop;
- no se mezclan decisiones de negocio con marketing o aspiraciones abstractas;
- cada documento debe responder a una pregunta concreta del sistema o de la operacion;
- cada flujo documentado debe corresponder a un servicio, evento o regla del producto que existe o esta planeado con claridad;
- cualquier cambio que no mejore catalogo, pedido, identidad, notificacion o operacion no es prioridad de esta fase.

## Estado

El frontend, `api-gateway`, `notification-worker`, `catalog-service` y `orders-service` compilan y tienen pruebas. El gateway expone `/healthz`, `/catalog/products`, `POST /orders` y `GET /orders/:orderId`; las rutas de pedido autentican al cliente y la lectura solo devuelve pedidos de ese propietario. `orders-service` valida catálogo y calcula los importes, guarda el estado inicial `PENDING` y devuelve el pedido incluso si la notificación queda pendiente. El outbox duradero reintenta entregas con backoff exponencial (desde 5 segundos, sondeo cada 5 segundos, máximo 5 minutos) y marca los eventos que agotan los 8 intentos para intervención operativa. Los servicios con persistencia tienen PostgreSQL propio, migraciones Prisma y health checks.

La primera version estable de la plataforma no se etiqueta ni se considera cerrada hasta cumplir el plan contenido en [docs/PLAN-V1-2026.md](docs/PLAN-V1-2026.md), que incluye alcance, milestones, calidad, preproduccion, pruebas unitarias e integracion, versionado semantico y evidencia de release.

## Version 1.0.0

La etiqueta formal `v1.0.0` solo se crea cuando se cumpla el Definition of Done de [docs/PLAN-V1-2026.md](docs/PLAN-V1-2026.md), incluyendo:

- `develop` estable y validada;
- release branch validada en CI;
- pruebas unitarias, de integracion y de entorno completadas;
- smoke tests y health checks en preproduccion o entorno equivalente;
- rollback y observabilidad documentados;
- versionado semantico y changelog de entrega.

## Documentacion operativa

La wiki del proyecto se mantiene en [docs/wiki/README.md](docs/wiki/README.md). Esta se usa para:

- arquitectura general del sistema;
- decisiones de diseño y normas de ingeniería;
- procedimientos de release y operacion;
- guias para mantener el proyecto en el tiempo sin depender de la memoria del autor.
