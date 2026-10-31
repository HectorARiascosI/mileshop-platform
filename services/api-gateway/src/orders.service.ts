import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

export const ORDER_FETCH = "ORDER_FETCH";
export const ORDERS_SERVICE_URL = "ORDERS_SERVICE_URL";

export type OrderLineInput = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type CreateOrderInput = {
  lines: OrderLineInput[];
};

export type OrderResult = {
  orderId: string;
  customerId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  lines: OrderLineInput[];
  event?: OrderEvent;
};

export type OrderEvent = {
  eventType: "OrderCreated.v1";
  eventId: string;
  occurredAt: string;
  aggregateId: string;
  payload: {
    customerId: string;
    subtotalCop?: number;
    deliveryFeeCop?: number;
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

export type CreatedOrderResult = OrderResult & { event: OrderEvent };

@Injectable()
export class OrderService {
  public constructor(
    @Inject(ORDER_FETCH) private readonly fetcher: typeof fetch,
    @Inject(ORDERS_SERVICE_URL) private readonly ordersServiceUrl: string,
  ) {}

  public async createOrder(
    input: CreateOrderInput,
    customerId: string,
    idempotencyKey: string,
  ): Promise<CreatedOrderResult> {
    const normalizedLines = input.lines.filter((line) => line.quantity > 0);
    let orderResponse: Response;
    try {
      orderResponse = await this.fetcher(`${this.ordersServiceUrl}/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ customerId, lines: normalizedLines }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    if (!orderResponse.ok) {
      const responseBody = await orderResponse.text();
      console.error(
        `Orders service createOrder failed: status=${orderResponse.status} body=${responseBody}`,
      );
      if (orderResponse.status === 400) {
        throw new BadRequestException("Order payload rejected by orders service");
      }
      if (orderResponse.status === 409) {
        throw new ConflictException("Idempotency key has already been used");
      }

      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    const orderResult = (await orderResponse.json()) as {
      data: {
        orderId: string;
        customerId: string;
        subtotalCop: number;
        deliveryFeeCop: number;
        totalCop: number;
        status: string;
        createdAt: string;
        updatedAt: string;
        lines: OrderLineInput[];
        event?: OrderEvent;
      };
    };

    const persistedOrder = orderResult.data;
    if (!persistedOrder.event) {
      throw new ServiceUnavailableException("Orders service did not return an OrderCreated event");
    }

    return {
      orderId: persistedOrder.orderId,
      subtotalCop: persistedOrder.subtotalCop,
      deliveryFeeCop: persistedOrder.deliveryFeeCop,
      totalCop: persistedOrder.totalCop,
      customerId: persistedOrder.customerId,
      status: persistedOrder.status,
      createdAt: persistedOrder.createdAt,
      updatedAt: persistedOrder.updatedAt,
      lines: persistedOrder.lines,
      event: persistedOrder.event,
    };
  }

  public async getOrder(orderId: string): Promise<OrderResult> {
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}`,
        { signal: AbortSignal.timeout(3_000) },
      );
    } catch {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    if (response.status === 404) {
      throw new NotFoundException("Order not found");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    const result = (await response.json()) as { data: OrderResult };
    return result.data;
  }
}
