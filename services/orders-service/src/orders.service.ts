import { Injectable } from "@nestjs/common";

import { OrderDomain } from "./orders.domain.js";
import type { OrderRecord } from "./orders.domain.js";
import { type OrdersRepository } from "./orders.repository.js";
import type { CreateOrderInput, Order } from "./orders.types.js";
import { createOrderSchema } from "./orders.validation.js";

@Injectable()
export class OrdersService {
  public constructor(private readonly repository: OrdersRepository) {}

  public async createOrder(input: CreateOrderInput): Promise<Order> {
    const parsed = createOrderSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error("Invalid order payload");
    }

    const record = OrderDomain.createOrder(parsed.data);
    await this.repository.save(record);
    return OrderDomain.toOrderView(record);
  }

  public async getOrderById(orderId: string): Promise<Order | null> {
    const record = await this.repository.findByOrderId(orderId);
    return record ? OrderDomain.toOrderView(record) : null;
  }
}
