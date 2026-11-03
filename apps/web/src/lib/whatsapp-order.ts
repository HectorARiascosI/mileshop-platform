export type WhatsAppOrderSummary = {
  orderId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCop: number;
  }>;
};

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeWhatsAppBusinessPhone(phone: string | undefined): string | null {
  if (!phone || !E164_PHONE_PATTERN.test(phone.trim())) {
    return null;
  }

  return phone.trim().slice(1);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function cleanMessageText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

export function isWhatsAppOrderSummary(order: unknown): order is WhatsAppOrderSummary {
  if (!order || typeof order !== "object") {
    return false;
  }

  const candidate = order as Partial<WhatsAppOrderSummary>;
  return (
    typeof candidate.orderId === "string" &&
    candidate.orderId.trim().length > 0 &&
    typeof candidate.subtotalCop === "number" &&
    isNonNegativeInteger(candidate.subtotalCop) &&
    typeof candidate.deliveryFeeCop === "number" &&
    isNonNegativeInteger(candidate.deliveryFeeCop) &&
    typeof candidate.totalCop === "number" &&
    isNonNegativeInteger(candidate.totalCop) &&
    Array.isArray(candidate.lines) &&
    candidate.lines.length > 0 &&
    candidate.lines.every(
      (line) =>
        line !== null &&
        typeof line === "object" &&
        typeof line.productId === "string" &&
        typeof line.sku === "string" &&
        typeof line.name === "string" &&
        line.name.trim().length > 0 &&
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0 &&
        isNonNegativeInteger(line.unitPriceCop) &&
        Number.isSafeInteger(line.quantity * line.unitPriceCop),
    )
  );
}

export function buildWhatsAppOrderUrl(
  businessPhone: string | undefined,
  order: unknown,
): string | null {
  const phone = normalizeWhatsAppBusinessPhone(businessPhone);
  if (!phone || !isWhatsAppOrderSummary(order)) {
    return null;
  }

  const lines = order.lines.map((line) => {
    const lineTotalCop = line.quantity * line.unitPriceCop;
    return `• ${line.quantity} x ${cleanMessageText(line.name)} (${cleanMessageText(line.sku)}): ${formatPrice(line.unitPriceCop)} c/u — ${formatPrice(lineTotalCop)}`;
  });
  const message = [
    `Hola MileShop, acabo de registrar el pedido ${cleanMessageText(order.orderId)}.`,
    "",
    "Resumen del pedido:",
    ...lines,
    "",
    `Subtotal: ${formatPrice(order.subtotalCop)}`,
    `Envío: ${order.deliveryFeeCop === 0 ? "Gratis" : formatPrice(order.deliveryFeeCop)}`,
    `Total: ${formatPrice(order.totalCop)}`,
    "",
    "Por favor, confirmen cómo continuar con el pago y la entrega. Cuando realice el pago, enviaré el comprobante manualmente como archivo adjunto en este chat.",
  ].join("\n");

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
