import { Inject, Injectable, Optional } from "@nestjs/common";

export const ORDER_FETCH = "ORDER_FETCH";
export const NOTIFICATION_WORKER_URL = "NOTIFICATION_WORKER_URL";

export type OrderLineInput = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type CreateOrderInput = {
  customerId: string;
  lines: OrderLineInput[];
};

export type OrderEvent = {
  eventType: "OrderCreated.v1";
  eventId: string;
  occurredAt: string;
  aggregateId: string;
  payload: {
    customerId: string;
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

export type CreatedOrderResult = {
  orderId: string;
  totalCop: number;
  event: OrderEvent;
};

@Injectable()
export class OrderService {
  public constructor(
    @Inject(ORDER_FETCH) private readonly fetcher: typeof fetch,
    @Optional()
    @Inject(NOTIFICATION_WORKER_URL)
    private readonly notificationWorkerUrl: string = process.env.NOTIFICATION_WORKER_URL ?? "http://localhost:3010",
  ) {}

  public async createOrder(input: CreateOrderInput): Promise<CreatedOrderResult> {
    const normalizedLines = input.lines.filter((line) => line.quantity > 0);
    const totalCop = normalizedLines.reduce(
      (total, line) => total + line.unitPriceCop * line.quantity,
      0,
    );
    const orderId = `order-${Date.now()}`;
    const event: OrderEvent = {
      eventType: "OrderCreated.v1",
      eventId: `${orderId}-event`,
      occurredAt: new Date().toISOString(),
      aggregateId: orderId,
      payload: {
        customerId: input.customerId,
        totalCop,
        currency: "COP",
        lines: normalizedLines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPriceCop: line.unitPriceCop,
        })),
      },
    };

    const response = await this.fetcher(`${this.notificationWorkerUrl}/events/order-created`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) {
      throw new Error(`notification worker rejected order creation: ${response.status}`);
    }

    return {
      orderId,
      totalCop,
      event,
    };
  }
}
