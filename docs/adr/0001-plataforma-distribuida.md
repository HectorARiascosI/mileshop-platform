# ADR 0001: Plataforma distribuida en monorepo

- Estado: aceptado
- Fecha: 2026-09-13
- Reemplaza: la arquitectura monolitica del repositorio legacy

## Contexto

`Proyecto_ventas` mezcla catalogo, identidad, carrito, pedidos, plantillas, persistencia y despliegue dentro de un unico proceso Django. La nueva plataforma debe permitir responsabilidades y despliegues independientes sin perder una vista coordinada del producto.

## Decision

MileShop se construye como una plataforma distribuida dentro de un monorepo:

- `apps/web` posee la experiencia web.
- `services/api-gateway` posee la entrada HTTP publica.
- Cada servicio de dominio posee su proceso y su base de datos.
- `packages/contracts` posee contratos compartidos y versionados.
- `infra` proporciona dependencias locales reproducibles.
- `Proyecto_ventas` permanece congelado como legacy y fuente temporal de migracion.

El monorepo no implica un monolito: los servicios no importan modelos, clientes Prisma ni codigo interno entre si.

## Reglas de evolucion

Un nuevo servicio requiere responsabilidad de negocio aislada, ownership de datos, contrato, pruebas, observabilidad, backup y rollback documentados. Separar un servicio en otro repositorio solo se decide cuando existan equipos, permisos o ciclos de despliegue independientes.

## Consecuencias

Se acepta el coste de operar varios procesos a cambio de reducir el acoplamiento y permitir despliegues por dominio. Las fronteras deben mantenerse mediante HTTP y eventos versionados; no se permiten lecturas directas entre bases.

## Rollback

La migracion desde legacy sigue un strangler pattern. Cada corte debe tener feature flag, reconciliacion, rollback a la ruta anterior y evidencia de datos afectados.
