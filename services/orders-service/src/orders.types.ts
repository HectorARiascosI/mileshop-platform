export type OrderStatus =
  | "PENDING"
  | "RESERVING_INVENTORY"
  | "AWAITING_PAYMENT_PROOF"
  | "PAYMENT_REVIEW_PENDING"
  | "PAYMENT_APPROVED_FINALIZING"
  | "RESERVATION_FAILED"
  | "CONFIRMED"
  | "RESERVATION_EXPIRED"
  | "CANCELLED";

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

export type PaymentDecisionView = {
  decision: "APPROVED" | "REJECTED";
  decidedAt: string;
  reason: string | null;
};

export type OrderCancellationRequestView = {
  requestedAt: string;
  resolvedAt: string | null;
  resolution: "CANCELLED" | "KEPT_OPEN" | null;
};

export type PendingCancellationRequest = {
  orderId: string;
  customerId: string;
  totalCop: number;
  createdAt: string;
  requestedAt: string;
  paymentCaptured: boolean | null;
  refundHandledAt: string | null;
  externalRefundReference: string | null;
  refundRecordedByCustomerId: string | null;
};

export type Order = {
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
  cancellationRequest: OrderCancellationRequestView | null;
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
