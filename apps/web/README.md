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
NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE=
```

`API_GATEWAY_URL` es una variable de servidor: las páginas y rutas API de Next.js la usan para comunicarse con el gateway sin exponerla al navegador. En Vercel debe configurarse como una URL HTTPS alcanzable desde las funciones, para cada entorno (Preview y Production). No se permite una URL HTTP en producción.

`NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE` es el número Business público en formato E.164, con `+` inicial y sin espacios; no es una credencial. Si no está configurado, el checkout no crea pedidos ni reserva inventario.

El despliegue acordado usa un proyecto Vercel para el storefront y cinco proyectos separados para los servicios NestJS, con PostgreSQL en Neon. Configura los seis proyectos y sus variables según [`docs/DEPLOYMENT-VERCEL-NEON.md`](../../docs/DEPLOYMENT-VERCEL-NEON.md); configurar solo `API_GATEWAY_URL` no constituye por sí mismo un despliegue end-to-end.

## Estructura principal

- `src/app/page.tsx` — catálogo y estado de disponibilidad
- `src/app/admin/catalog/page.tsx` — administración autenticada de productos y recepciones de inventario
- `src/app/admin/orders/page.tsx` — revisión de pedidos de WhatsApp y registro de ventas presenciales
- `src/app/layout.tsx` — shell global y metadata
- `src/app/globals.css` — estilos visuales del storefront

## Reglas del proyecto

- No se aceptan placeholders ni textos genéricos.
- Todo branding debe corresponder a MileShop.
- La capa web debe mantenerse orientada a consumo de servicios, no a mocks ni contenido demo.
