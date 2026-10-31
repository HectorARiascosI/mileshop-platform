export const ORDER_STATUSES = [
  "PENDING",
  "RESERVING_INVENTORY",
  "AWAITING_PAYMENT_PROOF",
  "PAYMENT_REVIEW_PENDING",
  "PAYMENT_APPROVED_FINALIZING",
  "RESERVATION_FAILED",
  "CONFIRMED",
  "RESERVATION_EXPIRED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentDecision = {
  decision: "APPROVED" | "REJECTED";
  decidedAt: string;
  reason: string | null;
};

type OrderStatusMessage = {
  title: string;
  description: string;
};

const STATUS_COPY: Record<OrderStatus, OrderStatusMessage> = {
  PENDING: {
    title: "Pedido recibido",
    description: "Estamos preparando tu pedido.",
  },
  RESERVING_INVENTORY: {
    title: "Confirmando disponibilidad",
    description: "Estamos reservando los productos. Esta página se actualizará automáticamente.",
  },
  AWAITING_PAYMENT_PROOF: {
    title: "Reserva activa",
    description: "Tu pedido está reservado. Envía el comprobante antes de que venza la reserva.",
  },
  PAYMENT_REVIEW_PENDING: {
    title: "Comprobante en revisión",
    description: "Recibimos tu comprobante. La reserva se mantiene mientras revisamos el pago.",
  },
  PAYMENT_APPROVED_FINALIZING: {
    title: "Pago aprobado, confirmando pedido",
    description: "El pago fue aprobado. Estamos confirmando el inventario reservado y actualizaremos este estado al terminar.",
  },
  RESERVATION_FAILED: {
    title: "No pudimos reservar el pedido",
    description: "La disponibilidad cambió antes de completar la reserva. No realices un pago por este pedido.",
  },
  CONFIRMED: {
    title: "Pedido confirmado",
    description: "El pago fue aprobado y tu pedido está confirmado.",
  },
  RESERVATION_EXPIRED: {
    title: "Reserva vencida",
    description:
      "No recibimos el comprobante antes del vencimiento. El pedido expiró y no se procesará ningún pago.",
  },
  CANCELLED: {
    title: "Pedido cancelado",
    description:
      "Cancelamos el pedido y la liberación de la reserva se procesa automáticamente. No realices pagos por este pedido.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && ORDER_STATUSES.some((status) => status === value);
}

export function isPaymentDecisionForStatus(
  value: unknown,
  status: unknown,
): value is PaymentDecision | null {
  if (value === null) {
    return true;
  }
  if (
    !isRecord(value) ||
    !isValidDate(value.decidedAt) ||
    (value.decision !== "APPROVED" && value.decision !== "REJECTED")
  ) {
    return false;
  }
  if (value.decision === "REJECTED") {
    return (
      status === "CANCELLED" &&
      typeof value.reason === "string" &&
      value.reason.trim().length > 0
    );
  }
  return value.reason === null;
}

export function getOrderStatusMessage(
  status: OrderStatus,
  decision: PaymentDecision | null,
): OrderStatusMessage {
  if (decision?.decision === "REJECTED") {
    return {
      title: "Pago rechazado",
      description:
        "El pago fue rechazado y el pedido quedó cancelado. No realices otro pago por este pedido.",
    };
  }
  if (decision?.decision === "APPROVED") {
    return status === "PAYMENT_APPROVED_FINALIZING"
      ? STATUS_COPY.PAYMENT_APPROVED_FINALIZING
      : {
          title: "Pago aprobado",
          description: "La revisión administrativa terminó y el pago de tu pedido fue aprobado.",
        };
  }
  return STATUS_COPY[status];
}
