# Backlog funcional v1 — MileShop Platform

## 1. Propósito del documento

Este documento define el backlog mínimo de la primera versión operativa del sistema. No es una lista genérica de features. Es una priorización real del negocio y de la ingeniería, con responsables lógicos, dependencias y criterios de aceptación concretos.

La v1 no se define como “todo lo que podría existir”, sino como las capacidades necesarias para que el negocio pueda:

- vender a través de catálogo;
- registrar clientes;
- gestionar promociones y merchandising;
- crear órdenes con trazabilidad;
- comunicar ventas al negocio mediante WhatsApp;
- operar la plataforma con control y observabilidad.

## 2. Principios del backlog

- cada item debe resolver una necesidad de negocio o de operación;
- cada item debe tener criterio de aceptación claro;
- cada item debe mapearse a un dominio técnico o servicio;
- cada item debe tener evidencia de validación antes de cerrar;
- el backlog se prioriza por impacto en venta y trazabilidad del negocio.

## 3. Estructura por módulos

### Módulo 1 — Catálogo público
### Módulo 2 — Registro y clientes
### Módulo 3 — Carrito y checkout
### Módulo 4 — Orden y notificación
### Módulo 5 — Administración del negocio
### Módulo 6 — Operación y calidad

## 4. Módulo 1 — Catálogo público

### EP-01 — Listado de productos activos
**Objetivo:** exponer un catálogo claro y organizado al cliente.

**Criterios de aceptación:**

- el cliente puede ver productos activos;
- cada producto muestra nombre, imagen, precio y categoría;
- productos no activos no aparecen;
- se pueden listar de forma natural por páginas o bloques visuales.

**Dominio responsable:** catalog service, web storefront.

**Dependencias:**

- product data model;
- category model;
- pricing source;
- product visibility rules.

### EP-02 — Detalle de producto
**Objetivo:** que el cliente tenga información suficiente para decidir comprar.

**Criterios de aceptación:**

- se muestra nombre, descripción, precio actual, imágenes y disponibilidad;
- la información de promoción o descuento se ve claramente;
- variantes o stock se reflejan en la UI si existen;
- la experiencia no depende de la memoria del cliente.

**Dominio responsable:** catalog service, storefront.

### EP-03 — Productos destacados y promocionados
**Objetivo:** apoyar estrategias comerciales de merchandising.

**Criterios de aceptación:**

- el sistema distingue productos destacados, promocionados y normales;
- la página principal o catalogo puede mostrar bloque de relevancia;
- cada elemento promocionado tiene un origen claro y un estado activo.

**Dominio responsable:** catalog service, admin merchandising.

---

## 5. Módulo 2 — Registro y clientes

### EP-04 — Registro de cliente requerido
**Objetivo:** garantizar identidad antes de la compra.

**Criterios de aceptación:**

- el cliente no puede confirmar un pedido sin registro válido;
- el sistema exige datos mínimos obligatorios;
- el flujo de compra bloquea el intento si falla la validación.

**Dominio responsable:** identity / auth service, gateway, checkout.

**Dependencias:**

- customer model;
- validation rules;
- authentication flow.

### EP-05 — Perfil del cliente
**Objetivo:** conservar contexto del consumidor para compras futuras.

**Criterios de aceptación:**

- el cliente puede actualizar datos básicos;
- la información se asocia al pedido;
- los datos necesarios para la toma de contacto quedan disponibles para el negocio.

**Dominio responsable:** identity service, user profile domain.

---

## 6. Módulo 3 — Carrito y checkout

### EP-06 — Agregar al carrito
**Objetivo:** soportar la selección del cliente.

**Criterios de aceptación:**

- se puede añadir un producto o variante al carrito;
- cantidad, precio y total se actualizan correctamente;
- no se acepta item no disponible.

**Dominio responsable:** storefront, gateway, order domain.

### EP-07 — Resumen del pedido
**Objetivo:** revisar antes de confirmar la compra.

**Criterios de aceptación:**

- el cliente ve subtotal, descuento y total final;
- se muestran los productos seleccionados con cantidades;
- se confirma la identidad del cliente antes del cierre del pedido.

**Dominio responsable:** gateway, orders service, frontend.

### EP-08 — Confirmación de compra
**Objetivo:** cerrar la venta con evidencia y trazabilidad.

**Criterios de aceptación:**

- la orden se crea con estado inicial válido;
- el cliente recibe confirmación visual;
- la orden queda persistida con relación al cliente;
- el proceso falla con validación clara si faltan datos o líneas inválidas.

**Dominio responsable:** orders service.

---

## 7. Módulo 4 — Orden y notificación

### EP-09 — Creación de orden
**Objetivo:** registrar la operación comercial con estructura clara.

**Criterios de aceptación:**

- cada orden tiene identificador único;
- cada línea incluye producto, cantidad y precio;
- el total es consistente con los datos finales;
- el estado inicial es correcto y auditable.

**Dominio responsable:** orders service.

### EP-10 — Evento de orden creada
**Objetivo:** permitir integración con el canal de ventas y atención comercial.

**Criterios de aceptación:**

- se publica un evento versionado al crear la orden;
- el payload incluye datos suficientes del cliente y del pedido;
- el evento tiene contrato definido y verificable;
- el sistema acepta y maneja reintentos sin duplicidad.

**Dominio responsable:** orders service, notification worker, contracts package.

### EP-11 — Notificación por WhatsApp
**Objetivo:** entregar una notificación útil al negocio.

**Criterios de aceptación:**

- el mensaje incluye cliente, pedido y resumen;
- la información del cliente es suficiente para atender la venta;
- el worker deduplica y emite solo una notificación válida por evento.

**Dominio responsable:** notification worker.

---

## 8. Módulo 5 — Administración del negocio

### EP-12 — Gestión de catálogo
**Objetivo:** permitir al negocio mantener la oferta actualizada.

**Criterios de aceptación:**

- el administrador puede crear, editar y desactivar productos;
- puede actualizar precio, descripción, imagen y categoría;
- las reglas de visibilidad se aplican inmediatamente.

**Dominio responsable:** admin console, catalog service.

### EP-13 — Gestión de promociones
**Objetivo:** permitir control comercial.

**Criterios de aceptación:**

- el administrador crea promociones activas/inactivas;
- las promociones se aplican a productos o categorías;
- el cliente ve el descuento en el storefront.

**Dominio responsable:** catalog service, pricing domain, admin console.

### EP-14 — Gestión de banners y publicaciones
**Objetivo:** sostener contenido visual y merchandising editorial.

**Criterios de aceptación:**

- el administrador puede crear y publicar banners y notas;
- cada contenido tiene estado y prioridad;
- contenido inactivo no aparece en el storefront.

**Dominio responsable:** catalog + content admin domain.

### EP-15 — Gestión de pedidos
**Objetivo:** apoyar la operación comercial del negocio.

**Criterios de aceptación:**

- el administrador puede consultar el pedido por cliente o fecha;
- puede ver el estado, el total y la información relevante;
- puede actualizar el estado de la orden cuando se avance en atención.

**Dominio responsable:** orders service, admin console.

---

## 9. Módulo 6 — Operación y calidad

### EP-16 — Health checks y observabilidad
**Objetivo:** garantizar soporte operativo.

**Criterios de aceptación:**

- cada servicio expone health checks;
- el gateway expone estado de dependencia principal;
- hay trazabilidad mínima para diagnóstico y soporte.

**Dominio responsable:** gateway, services, infra.

### EP-17 — Validación del stack local
**Objetivo:** reproducir el sistema correctamente.

**Criterios de aceptación:**

- el stack local puede levantarse con scripts o compose reproducibles;
- los servicios arrancan con configuraciones adecuadas;
- las pruebas del flujo principal se ejecutan con entorno realista.

**Dominio responsable:** infra + runbook + CI.

### EP-18 — Release y rollback
**Objetivo:** permitir entrega segura y reversión controlada.

**Criterios de aceptación:**

- cada release tiene pruebas públicas y evidencia;
- se documenta rollback cuando aplica;
- cambios grandes no se aceptan sin revisión y validación.

**Dominio responsable:** release process, engineering governance.

## 10. Prioridad de entrega

### Prioridad P0 — bloque de venta

- catálogo activo
- registro del cliente
- carrito y checkout
- orden
- notificación

### Prioridad P1 — control opertativo del negocio

- promociones
- mejoras de merchandising
- banners y notas
- gestión de pedidos por admin

### Prioridad P2 — refinamiento y crecimiento

- analytics
- mejoras de experiencia
- optimización editorial
- automatización operativa

## 11. Entregables v1 esperados

La v1 debe incluir los siguientes entregables funcionales:

1. catálogo público completo y operativo;
2. registro obligatorio con identidad del cliente;
3. carrito y resumen de compra;
4. creación de pedido con validación real;
5. notificación comercial al negocio;
6. administración básica del catálogo y contenido;
7. trazabilidad y observabilidad mínima.

## 12. Criterio de cierre del backlog v1

El backlog de la v1 queda cerrado cuando:

- todos los items P0 están implementados y validados;
- todos los items P1 necesarios para la operación están activos;
- cada feature tiene evidencia de prueba;
- cada flujo principal tiene smoke test;
- cada dominio tiene operación y rollback documentados.

## 13. Conclusión

Este backlog no tiene la intención de “abrir muchas posibilidades”. Tiene la intención de definir la mínima plataforma útil, operable y comercialmente viable para MileShop.

La prioridad no es construir una tienda bonita, sino un sistema capaz de sostener venta, registro, administración y atención comercial de forma reproducible y profesional.
