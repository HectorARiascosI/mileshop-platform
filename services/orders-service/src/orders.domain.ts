import type {
  CreateOrderCommand,
  OrderLine,
  OrderStatus,
  PaymentDecisionView,
} from "./orders.types.js";

export const FREE_DELIVERY_THRESHOLD_COP = 150_000;

export type OrderCancellationResolution = "CANCELLED" | "KEPT_OPEN";

export function parseOrderCancellationResolution(
  value: string | null,
): OrderCancellationResolution | null {
  if (value === null || value === "CANCELLED" || value === "KEPT_OPEN") {
    return value;
  }
  throw new Error(`Unknown cancellation resolution: ${value}`);
}

export type OrderRecord = {
  id: string;
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: OrderStatus;
  reservationExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelResolvedAt: Date | null;
  cancelResolution: OrderCancellationResolution | null;
  cancelResolvedByCustomerId: string | null;
  cancelResolutionNote: string | null;
  cancelPaymentCaptured: boolean | null;
  externalRefundRecordedByCustomerId: string | null;
  externalRefundReference: string | null;
  externalRefundHandledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  paymentDecision: {
    decision: PaymentDecisionView["decision"];
    decidedAt: Date;
    reason: string | null;
  } | null;
  lines: Array<{
    id: string;
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCop: number;
  }>;
};

export class OrderDomain {
  public static createOrder(command: CreateOrderCommand): OrderRecord {
    if (command.lines.length === 0) {
      throw new Error("Order must include at least one line");
    }
    const normalizedLines = command.lines;

    const now = new Date();
    const reservationExpiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1_000);
    const subtotalCop = normalizedLines.reduce<number>(
      (sum: number, line: CreateOrderCommand["lines"][number]) => sum + line.unitPriceCop * line.quantity,
      0,
    );
    const deliveryFeeCop =
      subtotalCop >= FREE_DELIVERY_THRESHOLD_COP
        ? 0
        : Math.max(12_000, Math.round(subtotalCop * 0.08));

    const orderId = `order-${crypto.randomUUID()}`;

    return {
      id: crypto.randomUUID(),
      orderId,
      customerId: command.customerId,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: OrderDomain.fingerprint(command),
      subtotalCop,
      deliveryFeeCop,
      totalCop: subtotalCop + deliveryFeeCop,
      status: "RESERVING_INVENTORY",
      reservationExpiresAt,
      cancelRequestedAt: null,
      cancelResolvedAt: null,
      cancelResolution: null,
      cancelResolvedByCustomerId: null,
      cancelResolutionNote: null,
      cancelPaymentCaptured: null,
      externalRefundRecordedByCustomerId: null,
      externalRefundReference: null,
      externalRefundHandledAt: null,
      createdAt: now,
      updatedAt: now,
      paymentDecision: null,
      lines: normalizedLines.map((line: CreateOrderCommand["lines"][number]) => ({
        id: crypto.randomUUID(),
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      })),
    };
  }

  public static fingerprint(command: CreateOrderCommand): string {
    return JSON.stringify({
      customerId: command.customerId,
      lines: command.lines.map(({ productId, sku, quantity, unitPriceCop }) => ({
        productId,
        sku,
        quantity,
        unitPriceCop,
      })),
    });
  }

  public static toOrderView(record: OrderRecord): {
    id: string;
    orderId: string;
    customerId: string;
    subtotalCop: number;
    deliveryFeeCop: number;
    totalCop: number;
    status: OrderStatus;
    reservationExpiresAt: string | null;
    createdAt: string;
    updatedAt: string;
    lines: OrderLine[];
    paymentDecision: PaymentDecisionView | null;
    cancellationRequest: {
      requestedAt: string;
      resolvedAt: string | null;
      resolution: "CANCELLED" | "KEPT_OPEN" | null;
    } | null;
  } {
    return {
      id: record.id,
      orderId: record.orderId,
      customerId: record.customerId,
      subtotalCop: record.subtotalCop,
      deliveryFeeCop: record.deliveryFeeCop,
      totalCop: record.totalCop,
      status: record.status,
      reservationExpiresAt: record.reservationExpiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      paymentDecision: record.paymentDecision
        ? {
            decision: record.paymentDecision.decision,
            decidedAt: record.paymentDecision.decidedAt.toISOString(),
            reason: record.paymentDecision.reason,
          }
        : null,
      cancellationRequest: record.cancelRequestedAt
        ? {
            requestedAt: record.cancelRequestedAt.toISOString(),
            resolvedAt: record.cancelResolvedAt?.toISOString() ?? null,
            resolution: record.cancelResolution,
          }
        : null,
      lines: record.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      })),
    };
  }
}
