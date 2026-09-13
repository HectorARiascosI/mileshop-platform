import type { CreateOrderCommand, OrderLine, OrderStatus } from "./orders.types.js";

export type OrderRecord = {
  id: string;
  orderId: string;
  customerId: string;
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
    const normalizedLines = command.lines.filter((line: CreateOrderCommand["lines"][number]) => line.quantity > 0);

    if (normalizedLines.length === 0) {
      throw new Error("Order must include at least one valid line");
    }

    const now = new Date();
    const totalCop = normalizedLines.reduce<number>(
      (sum: number, line: CreateOrderCommand["lines"][number]) => sum + line.unitPriceCop * line.quantity,
      0,
    );

    const orderId = `order-${now.getTime()}`;

    return {
      id: `order-record-${now.getTime()}`,
      orderId,
      customerId: command.customerId,
      totalCop,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
      lines: normalizedLines.map((line: CreateOrderCommand["lines"][number], index: number) => ({
        id: `${orderId}-line-${index + 1}`,
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
