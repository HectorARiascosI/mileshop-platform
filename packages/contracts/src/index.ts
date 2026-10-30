export type OrderCreatedV1 = {
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
