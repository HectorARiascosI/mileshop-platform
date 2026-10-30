import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
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

export type OrderEvent = {
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
    lines: OrderLineInput[];
  };
};

export type CreatedOrderResult = {
  orderId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  event: OrderEvent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderLine(value: unknown): value is OrderLineInput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.productId === "string" &&
    typeof value.sku === "string" &&
    typeof value.name === "string" &&
    typeof value.quantity === "number" &&
    Number.isSafeInteger(value.quantity) &&
    value.quantity > 0 &&
    typeof value.unitPriceCop === "number" &&
    Number.isSafeInteger(value.unitPriceCop) &&
    value.unitPriceCop >= 0
  );
}

function isCreatedOrderResult(value: unknown): value is CreatedOrderResult {
  if (!isRecord(value)) {
    return false;
  }
  const event = value.event;
  if (!isRecord(event)) {
    return false;
  }
  const payload = event.payload;
  if (!isRecord(payload)) {
    return false;
  }
  const lines = payload.lines;
  if (!Array.isArray(lines) || !lines.every(isOrderLine)) {
    return false;
  }
  const lineSubtotalCop = lines.reduce(
    (subtotal, line) => subtotal + line.unitPriceCop * line.quantity,
    0,
  );
  if (!Number.isSafeInteger(lineSubtotalCop) || lineSubtotalCop !== value.subtotalCop) {
    return false;
  }
  return (
    typeof value.orderId === "string" &&
    typeof value.subtotalCop === "number" &&
    Number.isSafeInteger(value.subtotalCop) &&
    typeof value.deliveryFeeCop === "number" &&
    Number.isSafeInteger(value.deliveryFeeCop) &&
    typeof value.totalCop === "number" &&
    Number.isSafeInteger(value.totalCop) &&
    value.totalCop === value.subtotalCop + value.deliveryFeeCop &&
    event.eventType === "OrderCreated.v1" &&
    typeof event.eventId === "string" &&
    typeof event.occurredAt === "string" &&
    event.aggregateId === value.orderId &&
    typeof payload.customerId === "string" &&
    payload.subtotalCop === value.subtotalCop &&
    payload.deliveryFeeCop === value.deliveryFeeCop &&
    payload.totalCop === value.totalCop &&
    payload.currency === "COP" &&
    lines.length > 0
  );
}

@Injectable()
export class OrderService {
  public constructor(
    @Inject(ORDER_FETCH) private readonly fetcher: typeof fetch,
    @Inject(ORDERS_SERVICE_URL) private readonly ordersServiceUrl: string,
  ) {}

  public async createOrder(
    input: unknown,
    customerId: string,
    idempotencyKey: string | undefined,
  ): Promise<CreatedOrderResult> {
    const request = this.validateRequest(input, customerId, idempotencyKey);

    let orderResponse: Response;
    try {
      orderResponse = await this.fetcher(`${this.ordersServiceUrl}/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify({ customerId: request.customerId, lines: request.lines }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service is unavailable",
        { cause: error },
      );
    }

    if (orderResponse.status === 400) {
      throw new BadRequestException("Order payload rejected by orders service");
    }
    if (orderResponse.status === 409) {
      throw new ConflictException("Order idempotency key conflicts with an existing request");
    }
    if (!orderResponse.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await orderResponse.json();
      if (!isRecord(payload) || !isCreatedOrderResult(payload.data)) {
        throw new Error("Orders service returned an invalid order response");
      }
      return payload.data;
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid response",
        { cause: error },
      );
    }
  }

  private validateRequest(
    input: unknown,
    customerId: string,
    idempotencyKey: string | undefined,
  ): { customerId: string; idempotencyKey: string; lines: OrderLineInput[] } {
    if (!customerId.trim() || customerId.length > 128) {
      throw new BadRequestException("Authenticated customer is required");
    }
    if (
      typeof idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
    ) {
      throw new BadRequestException("A valid Idempotency-Key UUID is required");
    }
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new BadRequestException("Invalid order payload");
    }

    const candidateLines = (input as { lines?: unknown }).lines;
    if (!Array.isArray(candidateLines) || candidateLines.length === 0 || candidateLines.length > 100) {
      throw new BadRequestException("Order must contain between 1 and 100 lines");
    }

    const lines: OrderLineInput[] = candidateLines.map((candidate: unknown) => {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        throw new BadRequestException("Invalid order line");
      }

      const line = candidate as Record<string, unknown>;
      if (
        typeof line.productId !== "string" ||
        !line.productId.trim() ||
        line.productId.length > 128 ||
        typeof line.sku !== "string" ||
        !line.sku.trim() ||
        line.sku.length > 128 ||
        typeof line.name !== "string" ||
        !line.name.trim() ||
        line.name.length > 200 ||
        typeof line.quantity !== "number" ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0 ||
        typeof line.unitPriceCop !== "number" ||
        !Number.isSafeInteger(line.unitPriceCop) ||
        line.unitPriceCop < 0
      ) {
        throw new BadRequestException("Invalid order line");
      }

      return {
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      };
    });

    return { customerId, idempotencyKey, lines };
  }
}
