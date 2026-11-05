import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWhatsAppOrderUrl,
  normalizeWhatsAppBusinessPhone,
  type WhatsAppCustomerDetails,
  type WhatsAppOrderSummary,
} from "./whatsapp-order";

const customer: WhatsAppCustomerDetails = {
  name: "María Fernanda Ríos",
  email: "maria@example.com",
  phone: "+573001234567",
};

const order: WhatsAppOrderSummary = {
  orderId: "order-2026-001",
  subtotalCop: 130000,
  deliveryFeeCop: 12000,
  totalCop: 142000,
  lines: [
    {
      productId: "product-1",
      sku: "SKU-01",
      name: "Botella térmica",
      quantity: 2,
      unitPriceCop: 65000,
    },
    {
      productId: "product-2",
      sku: "SKU-02",
      name: "Pañal premium",
      quantity: 1,
      unitPriceCop: 0,
    },
  ],
};

test("normaliza solo números de teléfono en formato internacional E.164", () => {
  assert.equal(normalizeWhatsAppBusinessPhone("+573001234567"), "573001234567");
  assert.equal(normalizeWhatsAppBusinessPhone("3001234567"), null);
  assert.equal(normalizeWhatsAppBusinessPhone("+0123456789"), null);
  assert.equal(normalizeWhatsAppBusinessPhone(undefined), null);
});

test("construye un mensaje legible con referencia, artículos y totales del pedido", () => {
  const result = buildWhatsAppOrderUrl("+573001234567", order, customer);
  assert.ok(result);

  const url = new URL(result);
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/573001234567");

  const message = url.searchParams.get("text") ?? "";
  assert.match(message, /\*MileShop\*\n_La exclusividad hecha a tu medida\._/);
  assert.match(message, /¡Hola!/);
  assert.match(message, /\*DATOS DEL CLIENTE\*\nNombre: María Fernanda Ríos\nTeléfono: \+573001234567\nCorreo: maria@example\.com/);
  assert.match(message, /\*MI PEDIDO\*/);
  assert.match(message, /order-2026-001/);
  assert.match(message, /• \*Botella térmica\*/);
  assert.match(message, /2 unidades × .*65\.000 c\/u/);
  assert.match(message, /Importe: \*.*130\.000\*/);
  assert.match(message, /• \*Pañal premium\*/);
  assert.doesNotMatch(message, /SKU-0[12]/);
  assert.match(message, /Subtotal:.*130\.000/);
  assert.match(message, /Envío:.*12\.000/);
  assert.match(message, /\*TOTAL:.*142\.000\*/);
  assert.match(message, /confirmen el método y los datos de pago/);
  assert.match(message, /enviaré el comprobante por este chat/);
});

test("presenta varias líneas y envío gratis sin alterar los importes", () => {
  const complexOrder: WhatsAppOrderSummary = {
    orderId: "order-complex-001",
    subtotalCop: 243000,
    deliveryFeeCop: 0,
    totalCop: 243000,
    lines: [
      { productId: "bottle", sku: "MILE-BTL-001", name: "Botella térmica", quantity: 2, unitPriceCop: 65000 },
      { productId: "notebook", sku: "MILE-NOTE-001", name: "Cuaderno de notas", quantity: 3, unitPriceCop: 19000 },
      { productId: "mug", sku: "MILE-MUG-001", name: "Taza de cerámica", quantity: 2, unitPriceCop: 28000 },
    ],
  };
  const result = buildWhatsAppOrderUrl("+573001234567", complexOrder, customer);
  assert.ok(result);

  const message = new URL(result).searchParams.get("text") ?? "";
  assert.equal((message.match(/• \*/g) ?? []).length, 3);
  assert.match(message, /2 unidades × .*65\.000 c\/u/);
  assert.match(message, /3 unidades × .*19\.000 c\/u/);
  assert.match(message, /2 unidades × .*28\.000 c\/u/);
  assert.match(message, /Envío: Gratis/);
  assert.match(message, /\*TOTAL:.*243\.000\*/);
  assert.doesNotMatch(message, /MILE-(BTL|NOTE|MUG)-001/);
});

test("incluye nombre y correo cuando el cliente no tiene teléfono registrado", () => {
  const result = buildWhatsAppOrderUrl("+573001234567", order, {
    name: "Cliente sin teléfono",
    email: "cliente@example.com",
  });
  assert.ok(result);

  const message = new URL(result).searchParams.get("text") ?? "";
  assert.match(message, /Nombre: Cliente sin teléfono/);
  assert.match(message, /Correo: cliente@example\.com/);
  assert.doesNotMatch(message, /Teléfono:/);
});

test("neutraliza controles y marcadores de formato en los datos del pedido", () => {
  const result = buildWhatsAppOrderUrl("+573001234567", {
    ...order,
    orderId: "order-2026\n*fake*",
    lines: [{ ...order.lines[0]!, name: "Taza\n*gratis* `promo`" }],
  }, {
    name: "María\n*Ríos*",
    email: "maria+shop@example.com",
    phone: "+57 300 123 4567",
  });
  assert.ok(result);

  const message = new URL(result).searchParams.get("text") ?? "";
  assert.match(message, /Referencia: order-2026 fake/);
  assert.match(message, /Nombre: María Ríos/);
  assert.match(message, /Correo: maria\+shop@example\.com/);
  assert.match(message, /Teléfono: \+57 300 123 4567/);
  assert.match(message, /• \*Taza gratis promo\*/);
  assert.doesNotMatch(message, /Taza\n|order-2026\n|`promo`/);
});

test("no crea enlace si falta el teléfono o el resumen no es válido", () => {
  assert.equal(buildWhatsAppOrderUrl(undefined, order, customer), null);
  assert.equal(buildWhatsAppOrderUrl("+573001234567", undefined, customer), null);
  assert.equal(
    buildWhatsAppOrderUrl("+573001234567", { ...order, lines: [] }, customer),
    null,
  );
  assert.equal(
    buildWhatsAppOrderUrl("+573001234567", {
      ...order,
      lines: [{ ...order.lines[0]!, quantity: 0 }],
    }, customer),
    null,
  );
  assert.equal(
    buildWhatsAppOrderUrl("+573001234567", {
      ...order,
      lines: [{ ...order.lines[0]!, name: "***" }],
    }, customer),
    null,
  );
  assert.equal(
    buildWhatsAppOrderUrl("+573001234567", order, { ...customer, name: "  " }),
    null,
  );
});
