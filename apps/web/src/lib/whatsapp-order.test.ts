import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWhatsAppOrderUrl,
  normalizeWhatsAppBusinessPhone,
  type WhatsAppOrderSummary,
} from "./whatsapp-order";

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

test("construye enlace con la referencia, todas las líneas y totales persistidos", () => {
  const result = buildWhatsAppOrderUrl("+573001234567", order);
  assert.ok(result);

  const url = new URL(result);
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/573001234567");

  const message = url.searchParams.get("text") ?? "";
  assert.match(message, /order-2026-001/);
  assert.match(message, /2 x Botella térmica \(SKU-01\)/);
  assert.match(message, /1 x Pañal premium \(SKU-02\)/);
  assert.match(message, /Subtotal:.*130\.000/);
  assert.match(message, /Envío:.*12\.000/);
  assert.match(message, /Total:.*142\.000/);
  assert.match(message, /comprobante manualmente como archivo adjunto/);
});

test("no crea enlace si falta el teléfono o el resumen no es válido", () => {
  assert.equal(buildWhatsAppOrderUrl(undefined, order), null);
  assert.equal(buildWhatsAppOrderUrl("+573001234567", undefined), null);
  assert.equal(
    buildWhatsAppOrderUrl("+573001234567", { ...order, lines: [] }),
    null,
  );
  assert.equal(
    buildWhatsAppOrderUrl("+573001234567", {
      ...order,
      lines: [{ ...order.lines[0]!, quantity: 0 }],
    }),
    null,
  );
});
