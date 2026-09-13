# ADR 0003: Storefront web con renderizado server-side

- Estado: aceptado
- Fecha: 2026-09-13
- Alcance: `apps/web`

## Contexto

La pantalla inicial generada por Next.js no representa el producto ni consume la plataforma. MileShop necesita una primera superficie real que funcione aunque el catalogo este vacio o temporalmente indisponible.

## Decision

La portada del storefront usa el App Router de Next.js y consulta `API_GATEWAY_URL` desde el servidor:

- El navegador no recibe la URL interna del servicio de catalogo.
- La pagina se renderiza dinamicamente con `cache: "no-store"`.
- El contrato esperado es `{ data: Product[] }`.
- Hay estados explicitos de productos, catalogo vacio y servicio indisponible.
- La interfaz es responsive y no inventa productos cuando la API falla.
- El carrito visible es una entrada de interfaz; su comportamiento se implementara en un slice separado.

## Verificacion

La pantalla debe validarse con typecheck, ESLint, build y una comprobacion visual en desktop y movil. El contenido accesible debe incluir marca, encabezado, estado del catalogo y pie.

## Rollback

El rollback consiste en revertir el commit del storefront o restaurar la version anterior de `apps/web`; no requiere cambios de base de datos.

## Consecuencias

La web depende de la disponibilidad del gateway en runtime. El diseño puede evolucionar sin cambiar la persistencia del catalogo, pero cualquier cambio de respuesta debe actualizar el cliente y sus pruebas de contrato.
