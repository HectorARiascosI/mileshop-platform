import type { OrderCreatedV1 } from "@mileshop/contracts";

import type { CartLine } from "./cart";

export const FREE_DELIVERY_THRESHOLD_COP = 150000;

export type CheckoutRequest = {
  customerId?: string;
  lines: CartLine[];
};

export type CheckoutSummary = {
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  isFreeDelivery: boolean;
};

export function buildCheckoutSummary(lines: CartLine[]): CheckoutSummary {
  const normalizedLines = lines.filter((line) => line.quantity > 0);
  const subtotalCop = normalizedLines.reduce(
    (total, line) => total + line.priceCop * line.quantity,
    0,
  );

  const isFreeDelivery = subtotalCop >= FREE_DELIVERY_THRESHOLD_COP;
  const deliveryFeeCop = isFreeDelivery ? 0 : Math.max(12000, Math.round(subtotalCop * 0.08));

  return {
    subtotalCop,
    deliveryFeeCop,
    totalCop: subtotalCop + deliveryFeeCop,
    isFreeDelivery,
  };
}

export function buildOrderCreatedEvent(lines: CartLine[], customerId = "guest-user"): OrderCreatedV1 {
  const normalizedLines = lines.filter((line) => line.quantity > 0);
  const summary = buildCheckoutSummary(normalizedLines);

  const occurredAt = new Date().toISOString();
  const orderId = `order-${Date.now()}`;

  return {
    eventType: "OrderCreated.v1",
    eventId: `${orderId}-event`,
    occurredAt,
    aggregateId: orderId,
    payload: {
      customerId,
      totalCop: summary.totalCop,
      currency: "COP",
      lines: normalizedLines.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.priceCop,
      })),
    },
  };
}
