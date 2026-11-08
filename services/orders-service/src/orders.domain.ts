import type { CreateOrderCommand, OrderLine, OrderStatus } from "./orders.types.js";
import {
  DELIVERY_FEE_COP,
  DELIVERY_FEE_THRESHOLD_COP,
} from "@mileshop/contracts";

export const ORDER_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

export type OrderCancellationResolution =
  | "CANCELLED_NO_PAYMENT"
  | "CANCELLED_PAYMENT_PENDING_REFUND"
  | "CANCELLED_PAYMENT_REFUNDED";

export function parseOrderCancellationResolution(
  value: string | null | undefined,
): OrderCancellationResolution | null {
  if (
    value === "CANCELLED_NO_PAYMENT" ||
    value === "CANCELLED_PAYMENT_PENDING_REFUND" ||
    value === "CANCELLED_PAYMENT_REFUNDED"
  ) {
    return value;
  }
  return null;
}

export type OrderRecord = {
  id: string;
  orderId: string;
  customerId: string;
  idempotencyKey: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  requestFingerprint?: string;
  reservationExpiresAt?: Date | null;
  paymentReportedAt?: Date | null;
  paymentReportedByCustomerId?: string | null;
  cancelRequestedAt?: Date | null;
  cancelResolvedAt?: Date | null;
  cancelResolution?: OrderCancellationResolution | null;
  cancelResolvedByCustomerId?: string | null;
  cancelResolutionNote?: string | null;
  cancelPaymentCaptured?: boolean | null;
  externalRefundRecordedByCustomerId?: string | null;
  externalRefundReference?: string | null;
  externalRefundHandledAt?: Date | null;
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
  public static applyReservedPrices(
    record: OrderRecord,
    reservedLines: Array<{
      productId: string;
      sku: string;
      name: string;
      quantity: number;
      unitPriceCop: number;
    }>,
  ): OrderRecord {
    const reservationByProduct = new Map(reservedLines.map((line) => [line.productId, line]));
    if (
      reservationByProduct.size !== reservedLines.length ||
      reservedLines.some(
        (line) =>
          !Number.isSafeInteger(line.unitPriceCop) ||
          line.unitPriceCop < 0 ||
          !Number.isSafeInteger(line.quantity) ||
          line.quantity <= 0,
      )
    ) {
      throw new Error("Catalog reservation contains invalid line data");
    }
    const orderQuantities = new Map<string, number>();
    for (const line of record.lines) {
      orderQuantities.set(
        line.productId,
        (orderQuantities.get(line.productId) ?? 0) + line.quantity,
      );
    }
    if (
      reservationByProduct.size !== orderQuantities.size ||
      [...orderQuantities].some(([productId, quantity]) => {
        const reserved = reservationByProduct.get(productId);
        return !reserved || reserved.quantity !== quantity;
      })
    ) {
      throw new Error("Catalog reservation does not match the order lines");
    }

    const lines = record.lines.map((line) => {
      const reserved = reservationByProduct.get(line.productId);
      if (!reserved) throw new Error("Catalog reservation snapshot does not match the order lines");
      return {
        ...line,
        sku: reserved.sku,
        name: reserved.name,
        unitPriceCop: reserved.unitPriceCop,
      };
    });
    const subtotalCop = lines.reduce(
      (sum, line) => sum + line.unitPriceCop * line.quantity,
      0,
    );
    const deliveryFeeCop =
      subtotalCop >= DELIVERY_FEE_THRESHOLD_COP
        ? 0
        : DELIVERY_FEE_COP;
    return {
      ...record,
      lines,
      subtotalCop,
      deliveryFeeCop,
      totalCop: subtotalCop + deliveryFeeCop,
    };
  }

  public static createOrder(command: CreateOrderCommand): OrderRecord {
    const normalizedLines = command.lines.filter((line: CreateOrderCommand["lines"][number]) => line.quantity > 0);

    if (normalizedLines.length === 0) {
      throw new Error("Order must include at least one valid line");
    }

    const now = new Date();
    const subtotalCop = normalizedLines.reduce<number>(
      (sum: number, line: CreateOrderCommand["lines"][number]) => sum + line.unitPriceCop * line.quantity,
      0,
    );
    const deliveryFeeCop =
      subtotalCop >= DELIVERY_FEE_THRESHOLD_COP
        ? 0
        : DELIVERY_FEE_COP;

    const orderId = `order-${crypto.randomUUID()}`;

    return {
      id: crypto.randomUUID(),
      orderId,
      customerId: command.customerId,
      idempotencyKey: command.idempotencyKey,
      subtotalCop,
      deliveryFeeCop,
      totalCop: subtotalCop + deliveryFeeCop,
      status: "RESERVING_INVENTORY",
      createdAt: now,
      updatedAt: now,
      requestFingerprint: command.idempotencyKey,
      reservationExpiresAt: null,
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

  public static toOrderView(record: OrderRecord): {
    id: string;
    orderId: string;
    customerId: string;
    subtotalCop: number;
    deliveryFeeCop: number;
    totalCop: number;
    status: OrderStatus;
    reservationExpiresAt: Date | null;
    paymentReportedAt: Date | null;
    createdAt: string;
    updatedAt: string;
    lines: OrderLine[];
    paymentDecision: null | {
      decision: string;
      decidedAt: string;
      reason: string | null;
    };
    cancellationRequest?: {
      requestedAt: string;
      resolution: string | null;
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
      reservationExpiresAt: record.reservationExpiresAt ?? null,
      paymentReportedAt: record.paymentReportedAt ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      lines: record.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      })),
      paymentDecision: null,
      cancellationRequest: (record as OrderRecord & {
        cancelRequestedAt?: Date;
        cancelResolution?: string | null;
      }).cancelRequestedAt
        ? {
            requestedAt: (record as any).cancelRequestedAt.toISOString(),
            resolution: (record as any).cancelResolution ?? null,
          }
        : null,
    };
  }
}
