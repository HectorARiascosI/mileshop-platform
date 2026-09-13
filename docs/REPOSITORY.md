# Identidad del repositorio

## Nombre

`mileshop-platform`

Nombre descriptivo, estable y sin informacion de proveedor. El repositorio remoto recomendado debe usar exactamente ese nombre.

## Que se sube

Se sube el contenido completo de esta carpeta:

- `apps/` para aplicaciones de usuario;
- `services/` para servicios desplegables;
- `packages/` para contratos y librerias compartidas;
- `infra/` para infraestructura local reproducible;
- configuracion, pruebas y documentacion.

No se sube el directorio padre `Proyecto_ventas`, `node_modules`, `dist`, clientes Prisma generados, `.data`, secretos ni bases locales.

## Numero de repositorios

La fase actual usa dos repositorios:

1. `Proyecto_ventas`: legacy congelado y referencia de migracion.
2. `mileshop-platform`: plataforma nueva distribuida en un monorepo.

Un monorepo no es un monolito. Cada servicio tiene proceso, contrato, ownership de datos y despliegue independiente. Separar cada servicio en un repositorio distinto se reconsidera solo cuando haya equipos, ciclos de despliegue o permisos realmente independientes.

## Regla de evolucion

La plataforma se divide por bounded contexts, no por carpetas arbitrarias. Un nuevo servicio debe justificar:

- responsabilidad de negocio aislada;
- base de datos propia;
- contrato versionado;
- pruebas de contrato e integracion;
- observabilidad;
- rollback y backup;
- beneficio operativo mayor que el coste de otro despliegue.
