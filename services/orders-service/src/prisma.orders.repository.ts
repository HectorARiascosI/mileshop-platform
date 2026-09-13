import type { PrismaClient } from "../generated/orders-client/index.js";

import type { OrderRecord } from "./orders.domain.js";
import type { OrdersRepository } from "./orders.repository.js";

export class PrismaOrdersRepository implements OrdersRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async save(record: OrderRecord): Promise<void> {
    await this.prisma.order.upsert({
      where: { orderId: record.orderId },
      update: {
        customerId: record.customerId,
        totalCop: record.totalCop,
        status: record.status,
        updatedAt: record.updatedAt,
        lines: {
          deleteMany: {},
          create: record.lines.map((line) => ({
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            quantity: line.quantity,
            unitPriceCop: line.unitPriceCop,
          })),
        },
      },
      create: {
        orderId: record.orderId,
        customerId: record.customerId,
        totalCop: record.totalCop,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lines: {
          create: record.lines.map((line) => ({
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            quantity: line.quantity,
            unitPriceCop: line.unitPriceCop,
          })),
        },
      },
    });
  }

  public async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({
      where: { orderId },
      include: { lines: true },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      totalCop: row.totalCop,
      status: row.status as OrderRecord["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines: row.lines.map((line) => ({
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
