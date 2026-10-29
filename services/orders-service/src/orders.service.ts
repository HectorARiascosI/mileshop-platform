import { Injectable } from "@nestjs/common";

import { CatalogReader } from "./catalog.reader.js";
import { OrderDomain } from "./orders.domain.js";
import type { OrderRecord } from "./orders.domain.js";
import { type OrdersRepository } from "./orders.repository.js";
import type { CreateOrderInput, Order } from "./orders.types.js";
import { createOrderSchema } from "./orders.validation.js";

@Injectable()
export class OrdersService {
  public constructor(
    private readonly repository: OrdersRepository,
    private readonly catalog: CatalogReader,
  ) {}

  public async createOrder(input: CreateOrderInput): Promise<Order> {
    const parsed = createOrderSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error("Invalid order payload");
    }

    const products = await this.catalog.listActiveProducts();
    const productsById = new Map(products.map((product) => [product.id, product]));
    const requestedQuantities = new Map<string, number>();

    const validatedLines = parsed.data.lines.map((line) => {
      const product = productsById.get(line.productId);
      if (!product) {
        throw new Error(`Product line is not current: ${line.productId}`);
      }

      if (product.sku !== line.sku) {
        throw new Error(`Product identity is not current: ${line.sku}`);
      }

      if (product.priceCop !== line.unitPriceCop) {
        throw new Error(`Product price is not current: ${line.sku}`);
      }

      const requestedQuantity = (requestedQuantities.get(product.id) ?? 0) + line.quantity;
      if (requestedQuantity > product.stock) {
        throw new Error(`Insufficient stock: ${line.sku}`);
      }
      requestedQuantities.set(product.id, requestedQuantity);
      return { ...line, name: product.name };
    });

    const record = OrderDomain.createOrder({
      ...parsed.data,
      lines: validatedLines,
    });
    await this.repository.save(record);
    return OrderDomain.toOrderView(record);
  }

  public async getOrderById(orderId: string): Promise<Order | null> {
    const record = await this.repository.findByOrderId(orderId);
    return record ? OrderDomain.toOrderView(record) : null;
  }
}
