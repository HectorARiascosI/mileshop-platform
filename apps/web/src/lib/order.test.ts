import assert from "node:assert/strict";
import test from "node:test";

import { buildCheckoutSummary, buildOrderCreatedEvent } from "./order";

test("calcula subtotal, envío y total del pedido", () => {
  const summary = buildCheckoutSummary([
    {
      productId: "p-1",
      sku: "SKU-01",
      name: "Botella térmica",
      priceCop: 65000,
      quantity: 2,
    },
    {
      productId: "p-2",
      sku: "SKU-02",
      name: "Pañal premium",
      priceCop: 42000,
      quantity: 1,
    },
  ]);

  assert.equal(summary.subtotalCop, 172000);
  assert.equal(summary.deliveryFeeCop, 0);
  assert.equal(summary.totalCop, 172000);
  assert.equal(summary.isFreeDelivery, true);
});

test("construye el evento de pedido con datos del cliente y líneas de compra", () => {
  const event = buildOrderCreatedEvent(
    [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        priceCop: 65000,
        quantity: 2,
      },
    ],
    "customer-42",
  );

  assert.equal(event.eventType, "OrderCreated.v1");
  assert.equal(event.payload.customerId, "customer-42");
  assert.equal(event.payload.totalCop, 142000);
  assert.equal(event.payload.lines.length, 1);
  assert.equal(event.payload.lines[0]?.sku, "SKU-01");
});

test("rechaza la creación del evento si no hay cliente identificado", () => {
  assert.throws(
    () =>
      buildOrderCreatedEvent(
        [
          {
            productId: "p-1",
            sku: "SKU-01",
            name: "Botella térmica",
            priceCop: 65000,
            quantity: 1,
          },
        ],
        "",
      ),
    /customerId/i,
  );
});
