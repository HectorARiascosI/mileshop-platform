# Requisitos de negocio y alcance funcional

## 1. Objetivo del negocio

MileShop Platform debe funcionar como una plataforma de comercio digital orientada a catálogo comercial, con compra por pedido y atención centrada en WhatsApp. El sistema debe permitir a la empresa comercializar productos y promociones de forma clara, agradable y operativa, mientras ofrece a los clientes un flujo de compra con identidad, contexto y confianza.

No se trata de un e-commerce genérico de mercado. La propuesta del negocio exige:

- catálogo editorial y comercial;
- registro obligatorio antes de la compra;
- gestión del contenido visual del negocio;
- promociones, descuentos y destacados;
- administración operativa del pedido;
- atención comercial por WhatsApp con datos contextuales del cliente.

## 2. Visión del producto

La plataforma debe permitir que:

- un cliente visite el catálogo y encuentre productos bien organizados;
- el negocio presente productos con imágenes, categorías y promociones;
- el cliente pueda registrarse con datos suficientes para identificarlo con claridad;
- el cliente pueda añadir productos al carrito, revisar el pedido y confirmarlo;
- la empresa reciba el pedido con contexto del cliente para atención comercial;
- el administrador gestione el catálogo, promociones y contenidos del negocio;
- el negocio pueda sostener ventas y merchandising sin depender de procesos manuales arbitrarios.

## 3. Actores del sistema

### 3.1 Cliente anónimo

Un visitante que explora el catálogo sin registrarse.

Puede:

- ver catálogo;
- navegar por categorías;
- visualizar productos, promociones y destacados;
- ver precios pactados;
- decidir entrar al flujo de compra.

Debe:

- registrarse antes de confirmar un pedido;
- no poder completar compra sin identidad verificable.

### 3.2 Cliente registrado

Un usuario identificado con datos mínimos necesarios para la venta.

Puede:

- completar perfil básico;
- almacenar contacto y datos de compra;
- añadir productos al carrito;
- confirmar pedido;
- recibir confirmación del proceso;
- consultar el estado de su orden.

### 3.3 Administrador

Un usuario administrativo con permisos para operar el negocio.

Puede:

- crear y editar productos;
- gestionar categorías y variantes;
- definir precios, descuentos y promociones;
- gestionar banners y publicaciones relevantes;
- controlar productos destacados;
- revisar pedidos y estados;
- validar la intención comercial antes de la atención al cliente.

## 4. Reglas del negocio

### 4.1 Registro previo a compra

La compra no debe completarse sin un cliente identificado.

Regla: todo pedido requiere usuario registrado y datos mínimos de contacto válidos.

### 4.2 Precio pactado

El producto debe mostrar siempre el precio vigente y consistente con la estrategia comercial actual.

Regla: el precio visible debe ser el precio que se entrega en la orden y no un valor ambiguo o escondido.

### 4.3 Merchandising y relevancia

El negocio debe poder indicar qué productos son relevantes, destacados, promocionados o con descuento.

Regla: la plataforma debe distinguir claramente entre producto normal, destacado y promocionado.

### 4.4 Control editorial

Los banners, notas, publicaciones y contenido promocional deben estar controlados por administración, no por contenido libre o caótico.

### 4.5 Notificación a ventas

Cada pedido debe producir una notificación útil para la empresa y su proceso comercial.

Regla: la notificación por WhatsApp debe incluir al menos:

- nombre del cliente;
- contacto principal;
- detalle del pedido;
- total o resumen de compra;
- referencia del pedido;
- estado del flujo comercial.

### 4.6 Trazabilidad del pedido

Debe existir seguimiento claro del pedido desde la creación hasta la atención comercial.

Regla: todo pedido debe tener estado, cambios y responsable del proceso.

## 5. Alcance funcional por módulo

## 5.1 Catalogo público

### Historias de usuario

#### HU-01: Explorar catálogo
Como cliente, quiero navegar por una lista organizada de productos, para encontrar rápidamente lo que necesito.

Criterios de aceptación:

- la home y el catálogo muestran productos activos;
- los productos se organizan por categorías;
- se muestra imagen, nombre, precio y estado del producto;
- un producto no activo no aparece al cliente.

#### HU-02: Ver detalle de producto
Como cliente, quiero ver la información detallada de un producto, para decidir si lo quiero comprar.

Criterios de aceptación:

- se muestra nombre, descripción, precio, variantes y disponibilidad;
- se muestra si el producto tiene promoción o descuento;
- la imagen principal y contenido visual están presentes;
- si hay variantes, se muestran correctamente.

#### HU-03: Ver productos destacados y promocionados
Como cliente, quiero ver productos relevantes y promocionados, para facilitar la decisión de compra.

Criterios de aceptación:

- el sistema distingue productos destacados;
- el sistema distingue promociones activas;
- los elementos relevantes aparecen en el storefront con jerarquía visual clara.

## 5.2 Registro y autenticación

#### HU-04: Registrarse antes de comprar
Como cliente, quiero registrarme con mis datos básicos, para completar el pedido con identidad y contexto.

Criterios de aceptación:

- la compra exige registro previo;
- el sistema valida datos mínimos obligatorios;
- el cliente no puede confirmar el pedido sin identidad válida.

#### HU-05: Mantener perfil del cliente
Como cliente, quiero mantener mis datos de contacto y compra, para agilizar futuras ventas.

Criterios de aceptación:

- el cliente puede actualizar datos básicos;
- los datos usados para la compra quedan asociados al cliente;
- la información de contacto es reutilizable en nuevos pedidos.

## 5.3 Carrito y checkout

#### HU-06: Agregar al carrito
Como cliente, quiero añadir productos al carrito, para prepararlo para compra.

Criterios de aceptación:

- se agrega una línea por producto o variante;
- se revisa disponibilidad antes de confirmar;
- el carrito refleja cantidad, precio y resumen.

#### HU-07: Revisar el pedido
Como cliente, quiero revisar el contenido del carrito antes de pagar o confirmar, para validar la compra.

Criterios de aceptación:

- se muestra resumen con subtotal, descuentos y total;
- la información del cliente queda asociada al pedido;
- se informa claramente si hay promociones o descuentos activos.

#### HU-08: Confirmar pedido
Como cliente, quiero confirmar mi pedido, para dejarlo registrado y listo para la atención comercial.

Criterios de aceptación:

- el pedido se crea con estado inicial válido;
- el sistema valida la compra y registra la orden;
- el cliente recibe una confirmación visual clara.

## 5.4 Pedido y notificación

#### HU-09: Crear orden
Como sistema, quiero crear una orden validada, para registrar la venta y permitir seguimiento.

Criterios de aceptación:

- la orden tiene estado inicial correcto;
- se registran líneas, precios y cantidades;
- la orden incluye identificación del cliente;
- si hay datos faltantes, la creación falla con validación apropiada.

#### HU-10: Enviar notificación comercial
Como empresa, quiero recibir la información del cliente y el pedido, para atender la venta en WhatsApp.

Criterios de aceptación:

- se envía un mensaje con datos relevantes del cliente;
- se incluye resumen del pedido;
- el mensaje se genera a partir del evento de orden;
- la notificación es idempotente y segura frente a reintentos.

## 5.5 Administración del negocio

#### HU-11: Gestionar catálogo
Como administrador, quiero crear, editar y desactivar productos, para mantener la oferta comercial actualizada.

Criterios de aceptación:

- se pueden crear productos con nombre, descripción, precio y categoría;
- se pueden cargar imágenes;
- se pueden activar o desactivar productos;
- se puede actualizar el estado del producto.

#### HU-12: Gestionar promociones
Como administrador, quiero gestionar promociones y descuentos, para regular la estrategia comercial del catálogo.

Criterios de aceptación:

- se pueden activar y desactivar promociones;
- las promociones se aplican al contexto correcto;
- el cliente ve el descuento y el cálculo real.

#### HU-13: Gestionar banners y contenidos relevantes
Como administrador, quiero administrar banners y publicaciones, para impulsar productos, promociones o contenido editorial.

Criterios de aceptación:

- el sistema soporta banners y publicaciones con estado activo/inactivo;
- cada contenido puede asociarse con un destino o producto;
- la vista del storefront refleja la prioridad visual correcta.

#### HU-14: Gestionar pedidos
Como administrador, quiero revisar los pedidos, para apoyar la atención del cliente y el flujo comercial.

Criterios de aceptación:

- se puede consultar el estado del pedido;
- se puede ver el cliente y su información relevante;
- se pueden actualizar estados cuando el flujo avanza.

## 6. Requisitos no funcionales

### 6.1 Rendimiento
- el catálogo debe responder de forma rápida y estable;
- el checkout y pedido deben ser consistentes bajo carga moderada;
- la experiencia debe evitar carga innecesaria para el usuario.

### 6.2 Seguridad
- no se deben guardar secretos dentro del repositorio;
- los datos del cliente deben manejarse con cuidado y trazabilidad;
- los administradores deben tener roles y permisos claros;
- las comunicaciones externas deben estar limitadas a canales autorizados.

### 6.3 Observabilidad
- existen logs claros de pedido, evento y notificación;
- es posible diagnosticar fallos de catálogo, pedido y envío;
- el flujo principal debe responder con health checks y trazas útiles.

### 6.4 Mantenibilidad
- el negocio debe poder evolucionar sin romper el modelo;
- cada servicio debe ser dueño de su dominio;
- la documentación debe mantenerse sincronizada con el código y el flujo.

## 7. Requisitos de datos y dominio

### 7.1 Entidades mínimas

- Customer
- CustomerAddress
- Product
- ProductVariant
- Category
- Promotion
- Banner
- Publication
- Cart
- CartItem
- Order
- OrderItem
- OrderStatus
- Notification
- MediaAsset

### 7.2 Relaciones mínimas

- un cliente tiene uno o varios pedidos;
- una categoría contiene muchos productos;
- un producto puede tener muchas variantes;
- una orden tiene varias líneas de pedido;
- una promoción puede aplicarse a productos o categorías;
- una publicación o banner puede promocionar productos y campañas;
- el pedido genera un evento de notificación.

## 8. Criterios de aceptación del módulo principal

La entrega mínima para la v1 debe cumplir estas condiciones:

1. catálogo activo visible para el cliente;
2. registro requerido antes del pedido;
3. compra completa con orden creada;
4. datos del cliente incluidos en la notificación comercial;
5. administración capaz de crear y editar productos y promociones;
6. flujo principal validado con pruebas automatizadas;
7. rollback y operación documentados;
8. no se rompe la separación por dominio ni la trazabilidad del negocio.

## 9. Backlog de entregables recomendado

### Módulo 1 — catálogo y merchandising
- listado y detalle de productos
- categorías y filtros
- banners y publicaciones
- destacados y promociones

### Módulo 2 — registro y cliente
- registro de cliente
- perfil básico
- contacto y datos de entrega
- validación previa a compra

### Módulo 3 — carrito y checkout
- agregar, quitar y actualizar cantidades
- resumen del pedido
- validación de precio y disponibilidad
- confirmación final

### Módulo 4 — orden y notificación
- creación de orden
- estado del pedido
- evento para notificación
- mensaje de WhatsApp con contexto del cliente

### Módulo 5 — administración
- CRUD de productos
- CRUD de promociones
- CRUD de banners y publicaciones
- gestión de pedidos y estado

## 10. Conclusión

Este proyecto debe entenderse como una plataforma de comercio digital con fuerte componente editorial y operacional, no como una demo ligera. La clave está en hacer explícitos los límites del negocio, el flujo del cliente, la regla del registro y la trazabilidad comercial.

Si estas reglas y módulos quedan bien definidos, la implementación será más segura, más clara y más fácil de escalar.
