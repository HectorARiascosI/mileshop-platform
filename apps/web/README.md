# MileShop Web

Frontend de catálogo para MileShop, construido con Next.js y Tailwind.

## Objetivo

Mostrar el catálogo público de productos con una experiencia simple, local y de compra rápida. La UI consume el gateway de la plataforma y no depende de datos locales ni plantillas genéricas.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
```

## Variables de entorno

```bash
API_GATEWAY_URL=http://localhost:3000
NEXT_PUBLIC_API_GATEWAY_URL=http://localhost:3000
```

En local, el servidor usa `API_GATEWAY_URL` para consultar `/catalog/products` y el checkout del navegador usa `NEXT_PUBLIC_API_GATEWAY_URL` para crear pedidos.

## Estructura principal

- `src/app/page.tsx` — catálogo y estado de disponibilidad
- `src/app/layout.tsx` — shell global y metadata
- `src/app/globals.css` — estilos visuales del storefront

## Reglas del proyecto

- No se aceptan placeholders ni textos genéricos.
- Todo branding debe corresponder a MileShop.
- La capa web debe mantenerse orientada a consumo de servicios, no a mocks ni contenido demo.
