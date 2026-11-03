import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export const ORDER_FETCH = "ORDER_FETCH";
export const ORDERS_SERVICE_URL = "ORDERS_SERVICE_URL";
export const ORDERS_INTERNAL_TOKEN = "ORDERS_INTERNAL_TOKEN";

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

export type OrderEvidenceStream = {
  stream: Readable;
  contentType: string;
  contentDisposition: string;
  contentLength?: number;
};

@Injectable()
export class OrderService {
  public constructor(
    @Inject(ORDER_FETCH) private readonly fetcher: typeof fetch,
    @Inject(ORDERS_SERVICE_URL) private readonly ordersServiceUrl: string,
    @Inject(ORDERS_INTERNAL_TOKEN) private readonly ordersInternalToken: string,
  ) {}

  private internalHeaders(customerId?: string, role = "CUSTOMER"): Record<string, string> {
    return {
      "x-orders-internal-token": this.ordersInternalToken,
      "x-authenticated-customer-id": customerId ?? "",
      "x-authenticated-role": role,
    };
  }

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
          ...this.internalHeaders(customerId),
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

  public async getOrder(
    orderId: string,
    customerId?: string,
    role = "CUSTOMER",
  ): Promise<OrderResult> {
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}`,
        { headers: this.internalHeaders(customerId, role), signal: AbortSignal.timeout(3_000) },
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

  public async listAdminOrders(customerId: string): Promise<OrderResult[]> {
    const response = await this.requestAdmin("/admin/orders", "GET", customerId);
    const result = (await response.json()) as { data: OrderResult[] };
    return result.data;
  }

  public async confirmAdminOrder(customerId: string, orderId: string): Promise<unknown> {
    const response = await this.requestAdmin(
      `/admin/orders/${encodeURIComponent(orderId)}/confirm`,
      "POST",
      customerId,
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async markPaymentReported(customerId: string, orderId: string): Promise<unknown> {
    const response = await this.requestAdmin(
      `/admin/orders/${encodeURIComponent(orderId)}/payment-reported`,
      "POST",
      customerId,
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async cancelAdminOrder(
    customerId: string,
    orderId: string,
    reason: string,
  ): Promise<unknown> {
    const response = await this.requestAdmin(
      `/admin/orders/${encodeURIComponent(orderId)}/cancel`,
      "POST",
      customerId,
      { reason },
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async cancelOrder(
    orderId: string,
    customerId: string,
    role: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/orders/${encodeURIComponent(orderId)}/cancel`,
      "POST",
      customerId,
      role,
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async requestCancellation(
    orderId: string,
    customerId: string,
    role: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/orders/${encodeURIComponent(orderId)}/cancellation-request`,
      "POST",
      customerId,
      role,
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async listPendingCancellationRequests(
    customerId: string,
    role: string,
  ): Promise<unknown> {
    const response = await this.requestAs("/admin/cancellation-requests", "GET", customerId, role);
    return (await response.json() as { data: unknown }).data;
  }

  public async recordCancellationRefund(
    orderId: string,
    customerId: string,
    role: string,
    paymentCaptured: boolean,
    externalRefundReference: string | null,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/cancellation-requests/${encodeURIComponent(orderId)}/refund-handling`,
      "POST",
      customerId,
      role,
      { paymentCaptured, externalRefundReference },
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async resolveCancellationRequest(
    orderId: string,
    customerId: string,
    role: string,
    action: "CANCEL" | "KEEP_OPEN",
    note: string | null,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/cancellation-requests/${encodeURIComponent(orderId)}/resolve`,
      "POST",
      customerId,
      role,
      { action, note },
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async uploadPaymentEvidence(
    orderId: string,
    customerId: string,
    role: string,
    form: FormData,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/orders/${encodeURIComponent(orderId)}/payment-evidence`,
      "POST",
      customerId,
      role,
      form,
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async getPaymentEvidence(
    orderId: string,
    customerId: string,
    role: string,
  ): Promise<OrderEvidenceStream> {
    return this.fetchEvidence(
      `/orders/${encodeURIComponent(orderId)}/payment-evidence`,
      customerId,
      role,
    );
  }

  public async listPendingPaymentReviews(customerId: string, role: string): Promise<unknown> {
    const response = await this.requestAs("/admin/payments", "GET", customerId, role);
    return (await response.json() as { data: unknown }).data;
  }

  public async getPendingPaymentReview(
    orderId: string,
    customerId: string,
    role: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/payments/${encodeURIComponent(orderId)}`,
      "GET",
      customerId,
      role,
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async getAdminPaymentEvidence(
    orderId: string,
    customerId: string,
    role: string,
  ): Promise<OrderEvidenceStream> {
    return this.fetchEvidence(
      `/admin/payments/${encodeURIComponent(orderId)}/evidence`,
      customerId,
      role,
    );
  }

  public async deleteAdminPaymentEvidence(
    orderId: string,
    customerId: string,
    role: string,
    confirmDownloaded: boolean,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/payments/${encodeURIComponent(orderId)}/evidence`,
      "POST",
      customerId,
      role,
      { confirmDownloaded },
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async approvePayment(
    orderId: string,
    customerId: string,
    role: string,
    reason?: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/payments/${encodeURIComponent(orderId)}/approve`,
      "POST",
      customerId,
      role,
      reason ? { reason } : {},
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async rejectPayment(
    orderId: string,
    customerId: string,
    role: string,
    reason: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/payments/${encodeURIComponent(orderId)}/reject`,
      "POST",
      customerId,
      role,
      { reason },
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async placePaymentEvidenceLegalHold(
    orderId: string,
    customerId: string,
    role: string,
    reason: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/payment-evidence/${encodeURIComponent(orderId)}/legal-hold`,
      "POST",
      customerId,
      role,
      { reason },
    );
    return (await response.json() as { data: unknown }).data;
  }

  public async releasePaymentEvidenceLegalHold(
    orderId: string,
    customerId: string,
    role: string,
    reason: string,
  ): Promise<unknown> {
    const response = await this.requestAs(
      `/admin/payment-evidence/${encodeURIComponent(orderId)}/legal-hold`,
      "DELETE",
      customerId,
      role,
      { reason },
    );
    return (await response.json() as { data: unknown }).data;
  }

  private async requestAdmin(
    path: string,
    method: "GET" | "POST",
    customerId: string,
    body?: unknown,
  ): Promise<Response> {
    return this.requestAs(path, method, customerId, "STORE_ADMIN", body);
  }

  private async requestAs(
    path: string,
    method: "GET" | "POST" | "DELETE",
    customerId: string,
    role: string,
    body?: unknown,
  ): Promise<Response> {
    let response: Response;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    try {
      response = await this.fetcher(`${this.ordersServiceUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
          ...this.internalHeaders(customerId, role),
        },
        ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    if (response.status === 404) throw new NotFoundException("Order not found");
    if (response.status === 400) throw new BadRequestException("Order decision was rejected");
    if (response.status === 403) throw new ForbiddenException();
    if (response.status === 409) throw new ConflictException("Order is no longer pending");
    if (!response.ok) throw new ServiceUnavailableException("Orders service is unavailable");
    return response;
  }

  private async fetchEvidence(
    path: string,
    customerId: string,
    role: string,
  ): Promise<OrderEvidenceStream> {
    const response = await this.requestAs(path, "GET", customerId, role);
    if (!response.body) {
      throw new ServiceUnavailableException("Orders service returned an empty payment evidence stream");
    }
    const contentLengthValue = response.headers.get("content-length");
    const contentLength = contentLengthValue ? Number(contentLengthValue) : undefined;
    return {
      stream: Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      contentDisposition:
        response.headers.get("content-disposition") ?? 'attachment; filename="payment-evidence"',
      ...(contentLength !== undefined && Number.isSafeInteger(contentLength)
        ? { contentLength }
        : {}),
    };
  }
}
