import type { OrderCreatedV1 } from "@mileshop/contracts";

import type { CartLine } from "./cart";

export const FREE_DELIVERY_THRESHOLD_COP = 150000;
const PENDING_CHECKOUT_KEY = "mileshop-pending-checkout-v1";

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

export function getCheckoutIdempotencyKey(
  lines: CartLine[],
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): string {
  const fingerprint = JSON.stringify(
    lines.map(({ productId, sku, quantity, priceCop }) => ({
      productId,
      sku,
      quantity,
      unitPriceCop: priceCop,
    })),
  );

  const pending = storage.getItem(PENDING_CHECKOUT_KEY);
  if (pending) {
    try {
      const parsed = JSON.parse(pending) as { fingerprint?: unknown; key?: unknown };
      if (
        parsed.fingerprint === fingerprint &&
        typeof parsed.key === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.key)
      ) {
        return parsed.key;
      }
    } catch {
      storage.removeItem(PENDING_CHECKOUT_KEY);
    }
  }

  const key = crypto.randomUUID();
  storage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({ fingerprint, key }));
  return key;
}

export function clearCheckoutIdempotencyKey(
  storage: Pick<Storage, "removeItem">,
): void {
  storage.removeItem(PENDING_CHECKOUT_KEY);
}

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

  if (!customerId || !customerId.trim()) {
    throw new Error("customerId is required to create an order");
  }

  if (normalizedLines.length === 0) {
    throw new Error("At least one order line is required");
  }

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
      subtotalCop: summary.subtotalCop,
      deliveryFeeCop: summary.deliveryFeeCop,
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
