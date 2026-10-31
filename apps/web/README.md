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

`NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE` es el número Business público en formato internacional E.164, sin espacios; no es una credencial.

Vercel aloja la aplicación Next.js y sus rutas API, pero no despliega automáticamente los servicios NestJS ni sus bases de datos. El gateway y los servicios deben estar desplegados por separado y ser accesibles desde Vercel; configurar esta variable no constituye por sí solo un despliegue end-to-end.

## Estructura principal

- `src/app/page.tsx` — catálogo y estado de disponibilidad
- `src/app/layout.tsx` — shell global y metadata
- `src/app/globals.css` — estilos visuales del storefront

## Reglas del proyecto

- No se aceptan placeholders ni textos genéricos.
- Todo branding debe corresponder a MileShop.
- La capa web debe mantenerse orientada a consumo de servicios, no a mocks ni contenido demo.
