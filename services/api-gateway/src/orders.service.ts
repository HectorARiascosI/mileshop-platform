import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

export const ORDER_FETCH = "ORDER_FETCH";
export const ORDERS_SERVICE_URL = "ORDERS_SERVICE_URL";
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
    @Inject(NOTIFICATION_WORKER_URL) private readonly notificationWorkerUrl: string,
    @Inject(ORDERS_SERVICE_URL) private readonly ordersServiceUrl: string,
  ) {}

  public async createOrder(input: CreateOrderInput): Promise<CreatedOrderResult> {
    const normalizedLines = input.lines.filter((line) => line.quantity > 0);
    const orderResponse = await this.fetcher(`${this.ordersServiceUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: input.customerId, lines: normalizedLines }),
      signal: AbortSignal.timeout(3_000),
    });

    if (!orderResponse.ok) {
      if (orderResponse.status === 400) {
        throw new BadRequestException("Order payload rejected by orders service");
      }

      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    const orderResult = (await orderResponse.json()) as {
      data: {
        orderId: string;
        customerId: string;
        totalCop: number;
        lines: OrderLineInput[];
      };
    };
    const persistedOrder = orderResult.data;
    const { orderId, totalCop } = persistedOrder;
    const event: OrderEvent = {
      eventType: "OrderCreated.v1",
      eventId: `${orderId}-event`,
      occurredAt: new Date().toISOString(),
      aggregateId: orderId,
      payload: {
        customerId: persistedOrder.customerId,
        totalCop,
        currency: "COP",
        lines: persistedOrder.lines.map((line) => ({
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
      throw new ServiceUnavailableException("Notification worker is unavailable");
    }

    return {
      orderId,
      totalCop,
      event,
    };
  }
}
