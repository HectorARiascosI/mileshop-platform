export type OrderStatus =
  | "PENDING"
  | "RESERVING_INVENTORY"
  | "AWAITING_PAYMENT_PROOF"
  | "PAYMENT_REVIEW_PENDING"
  | "PAYMENT_APPROVED_FINALIZING"
  | "CONFIRMED"
  | "CANCELLED"
  | "RESERVATION_EXPIRED"
  | "RESERVATION_FAILED";

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

export type Order = {
  id: string;
  orderId: string;
  customerId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: OrderStatus;
  reservationExpiresAt: Date | null;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
  event?: OrderCreatedEvent;
};
