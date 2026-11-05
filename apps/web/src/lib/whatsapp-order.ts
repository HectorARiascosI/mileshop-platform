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

export type WhatsAppCustomerDetails = {
  name: string;
  email: string;
  phone?: string;
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
  return value.replace(/[\u0000-\u001f\u007f*_~`]/g, " ").replace(/\s+/g, " ").trim();
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

export function isWhatsAppCustomerDetails(value: unknown): value is WhatsAppCustomerDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<WhatsAppCustomerDetails>;
  return (
    typeof candidate.name === "string" &&
    cleanMessageText(candidate.name).length > 0 &&
    typeof candidate.email === "string" &&
    cleanMessageText(candidate.email).length > 0 &&
    (candidate.phone === undefined ||
      (typeof candidate.phone === "string" && cleanMessageText(candidate.phone).length > 0))
  );
}

export function isWhatsAppOrderSummary(order: unknown): order is WhatsAppOrderSummary {
  if (!order || typeof order !== "object") {
    return false;
  }

  const candidate = order as Partial<WhatsAppOrderSummary>;
  return (
    typeof candidate.orderId === "string" &&
    cleanMessageText(candidate.orderId).length > 0 &&
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
        cleanMessageText(line.name).length > 0 &&
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
  customer: unknown,
): string | null {
  const phone = normalizeWhatsAppBusinessPhone(businessPhone);
  if (!phone || !isWhatsAppOrderSummary(order) || !isWhatsAppCustomerDetails(customer)) {
    return null;
  }

  const customerLines = [
    `Nombre: ${cleanMessageText(customer.name)}`,
    ...(customer.phone ? [`Teléfono: ${cleanMessageText(customer.phone)}`] : []),
    `Correo: ${cleanMessageText(customer.email)}`,
  ];
  const lines = order.lines.flatMap((line) => {
    const name = cleanMessageText(line.name);
    const lineTotalCop = line.quantity * line.unitPriceCop;
    return [
      `• *${name}*`,
      `  ${line.quantity} unidades × ${formatPrice(line.unitPriceCop)} c/u`,
      `  Importe: *${formatPrice(lineTotalCop)}*`,
    ];
  });
  const message = [
    "*MileShop*",
    "_La exclusividad hecha a tu medida._",
    "",
    "¡Hola! 👋",
    "He registrado este pedido y quisiera continuar con el proceso.",
    "",
    "*DATOS DEL CLIENTE*",
    ...customerLines,
    "",
    "*MI PEDIDO*",
    `Referencia: ${cleanMessageText(order.orderId)}`,
    "",
    "*PRODUCTOS*",
    ...lines,
    "",
    "*RESUMEN DE COMPRA*",
    `Subtotal: ${formatPrice(order.subtotalCop)}`,
    `Envío: ${order.deliveryFeeCop === 0 ? "Gratis" : formatPrice(order.deliveryFeeCop)}`,
    `*TOTAL: ${formatPrice(order.totalCop)}*`,
    "",
    "*SIGUIENTE PASO*",
    "Por favor, confirmen el método y los datos de pago, junto con los detalles de entrega. Una vez realizado el pago, enviaré el comprobante por este chat.",
    "",
    "¡Muchas gracias!",
  ].join("\n");

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
