import type { OrderRecord } from "./orders.domain.js";

export interface OrdersRepository {
  save(record: OrderRecord): Promise<void>;
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
}

export class InMemoryOrdersRepository implements OrdersRepository {
  private readonly records = new Map<string, OrderRecord>();

  public async save(record: OrderRecord): Promise<void> {
    this.records.set(record.orderId, record);
  }

  public async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const record = this.records.get(orderId);
    return record ? structuredClone(record) : null;
  }
}
