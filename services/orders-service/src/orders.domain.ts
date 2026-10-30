import type { CreateOrderCommand, OrderLine, OrderStatus } from "./orders.types.js";

export const FREE_DELIVERY_THRESHOLD_COP = 150_000;

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
  createdAt: Date;
  updatedAt: Date;
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
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
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
    createdAt: string;
    updatedAt: string;
    lines: OrderLine[];
  } {
    return {
      id: record.id,
      orderId: record.orderId,
      customerId: record.customerId,
      subtotalCop: record.subtotalCop,
      deliveryFeeCop: record.deliveryFeeCop,
      totalCop: record.totalCop,
      status: record.status,
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
    };
  }
}
