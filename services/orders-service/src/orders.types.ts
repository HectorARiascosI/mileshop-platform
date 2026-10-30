export type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export type OrderLineInput = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type CreateOrderCommand = {
  customerId: string;
  idempotencyKey: string;
  lines: OrderLineInput[];
};

export type CreateOrderInput = CreateOrderCommand;

export type OrderLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type Order = {
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
};

export type OrderCreatedEvent = {
  eventType: "OrderCreated.v1";
  eventId: string;
  occurredAt: string;
  aggregateId: string;
  payload: {
    customerId: string;
    subtotalCop: number;
    deliveryFeeCop: number;
    totalCop: number;
    currency: "COP";
    lines: Array<{
      productId: string;
      sku: string;
      name: string;
      quantity: number;
      unitPriceCop: number;
    }>;
  };
};

export type CreatedOrder = Order & { event: OrderCreatedEvent };
