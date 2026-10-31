import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Readable } from "node:stream";

import type { CustomerRole } from "./auth.middleware.js";

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
  status:
    | "PENDING"
    | "RESERVING_INVENTORY"
    | "AWAITING_PAYMENT_PROOF"
    | "PAYMENT_REVIEW_PENDING"
    | "PAYMENT_APPROVED_FINALIZING"
    | "RESERVATION_FAILED"
    | "CONFIRMED"
    | "RESERVATION_EXPIRED"
    | "CANCELLED";
  reservationExpiresAt: string | null;
  paymentDecision: OrderPaymentDecision | null;
  cancellationRequest: OrderCancellationRequest | null;
  event: OrderEvent;
};

export type OrderPaymentDecision = {
  decision: "APPROVED" | "REJECTED";
  decidedAt: string;
  reason: string | null;
};

export type OrderCancellationRequest = {
  requestedAt: string;
  resolvedAt: string | null;
  resolution: "CANCELLED" | "KEPT_OPEN" | null;
};

export type OrderResult = {
  id: string;
  orderId: string;
  customerId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: CreatedOrderResult["status"];
  reservationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: Array<OrderLineInput & { id: string }>;
  paymentDecision: OrderPaymentDecision | null;
  cancellationRequest: OrderCancellationRequest | null;
};

export type PaymentEvidenceReceipt = {
  orderId: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  transactionReference: string | null;
  receivedAt: string;
  status: "PAYMENT_REVIEW_PENDING";
};

export type PaymentEvidenceStream = {
  stream: Readable;
  contentType: string;
  contentDisposition: string;
  contentLength: number;
};

export type PaymentEvidenceReviewMetadata = {
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  transactionReference: string | null;
  receivedAt: string;
  available: boolean;
  deletedAt: string | null;
};

export type PaymentEvidenceReviewSummary = {
  orderId: string;
  customerId: string;
  totalCop: number;
  createdAt: string;
  reservationExpiresAt: string | null;
  evidence: PaymentEvidenceReviewMetadata;
};

export type PaymentEvidenceReviewDetail = {
  order: OrderResult;
  evidence: PaymentEvidenceReviewMetadata;
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

function isOrderStatus(value: unknown): value is CreatedOrderResult["status"] {
  return (
    value === "PENDING" ||
    value === "RESERVING_INVENTORY" ||
    value === "AWAITING_PAYMENT_PROOF" ||
    value === "PAYMENT_REVIEW_PENDING" ||
    value === "PAYMENT_APPROVED_FINALIZING" ||
    value === "RESERVATION_FAILED" ||
    value === "CONFIRMED" ||
    value === "RESERVATION_EXPIRED" ||
    value === "CANCELLED"
  );
}

function isPaymentDecision(value: unknown): value is OrderPaymentDecision | null {
  if (value === null) {
    return true;
  }
  return (
    isRecord(value) &&
    (value.decision === "APPROVED" || value.decision === "REJECTED") &&
    typeof value.decidedAt === "string" &&
    Number.isFinite(Date.parse(value.decidedAt)) &&
    (value.reason === null || typeof value.reason === "string")
  );
}

function isCancellationRequest(value: unknown): value is OrderCancellationRequest | null {
  if (value === null) {
    return true;
  }
  if (
    !isRecord(value) ||
    typeof value.requestedAt !== "string" ||
    !Number.isFinite(Date.parse(value.requestedAt)) ||
    (value.resolvedAt !== null &&
      (typeof value.resolvedAt !== "string" ||
        !Number.isFinite(Date.parse(value.resolvedAt)))) ||
    (value.resolution !== null &&
      value.resolution !== "CANCELLED" &&
      value.resolution !== "KEPT_OPEN")
  ) {
    return false;
  }
  return (value.resolvedAt === null) === (value.resolution === null);
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
    isOrderStatus(value.status) &&
    (value.reservationExpiresAt === null || typeof value.reservationExpiresAt === "string") &&
    isPaymentDecision(value.paymentDecision) &&
    isCancellationRequest(value.cancellationRequest) &&
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

function isOrderResult(value: unknown): value is OrderResult {
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    return false;
  }
  const lines = value.lines;
  return (
    typeof value.id === "string" &&
    typeof value.orderId === "string" &&
    typeof value.customerId === "string" &&
    typeof value.subtotalCop === "number" &&
    Number.isSafeInteger(value.subtotalCop) &&
    typeof value.deliveryFeeCop === "number" &&
    Number.isSafeInteger(value.deliveryFeeCop) &&
    typeof value.totalCop === "number" &&
    Number.isSafeInteger(value.totalCop) &&
    isOrderStatus(value.status) &&
    (value.reservationExpiresAt === null ||
      (typeof value.reservationExpiresAt === "string" &&
        Number.isFinite(Date.parse(value.reservationExpiresAt)))) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    lines.every(
      (line) =>
        isRecord(line) &&
        typeof line.id === "string" &&
        isOrderLine(line),
    ) &&
    isPaymentDecision(value.paymentDecision) &&
    isCancellationRequest(value.cancellationRequest) &&
    value.totalCop === value.subtotalCop + value.deliveryFeeCop
  );
}

function isPaymentEvidenceReviewMetadata(
  value: unknown,
): value is PaymentEvidenceReviewMetadata {
  return (
    isRecord(value) &&
    typeof value.originalFileName === "string" &&
    (value.contentType === "application/pdf" ||
      value.contentType === "image/jpeg" ||
      value.contentType === "image/png") &&
    typeof value.sizeBytes === "number" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    (value.transactionReference === null ||
      typeof value.transactionReference === "string") &&
    typeof value.receivedAt === "string" &&
    Number.isFinite(Date.parse(value.receivedAt)) &&
    typeof value.available === "boolean" &&
    (value.deletedAt === null ||
      (typeof value.deletedAt === "string" &&
        Number.isFinite(Date.parse(value.deletedAt))))
  );
}

function isPendingCancellationRequest(value: unknown): value is PendingCancellationRequest {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    typeof value.customerId === "string" &&
    typeof value.totalCop === "number" &&
    Number.isSafeInteger(value.totalCop) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.requestedAt === "string" &&
    Number.isFinite(Date.parse(value.requestedAt)) &&
    (value.paymentCaptured === null || typeof value.paymentCaptured === "boolean") &&
    (value.refundHandledAt === null ||
      (typeof value.refundHandledAt === "string" &&
        Number.isFinite(Date.parse(value.refundHandledAt)))) &&
    (value.externalRefundReference === null ||
      typeof value.externalRefundReference === "string") &&
    (value.refundRecordedByCustomerId === null ||
      typeof value.refundRecordedByCustomerId === "string")
  );
}

function isPaymentEvidenceReviewSummary(
  value: unknown,
): value is PaymentEvidenceReviewSummary {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    typeof value.customerId === "string" &&
    typeof value.totalCop === "number" &&
    Number.isSafeInteger(value.totalCop) &&
    value.totalCop >= 0 &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    (value.reservationExpiresAt === null ||
      (typeof value.reservationExpiresAt === "string" &&
        Number.isFinite(Date.parse(value.reservationExpiresAt)))) &&
    isPaymentEvidenceReviewMetadata(value.evidence)
  );
}

function isPaymentEvidenceReviewDetail(
  value: unknown,
): value is PaymentEvidenceReviewDetail {
  return (
    isRecord(value) &&
    isOrderResult(value.order) &&
    value.order.status === "PAYMENT_REVIEW_PENDING" &&
    isPaymentEvidenceReviewMetadata(value.evidence)
  );
}

function publicReviewMetadata(
  evidence: PaymentEvidenceReviewMetadata,
): PaymentEvidenceReviewMetadata {
  return {
    originalFileName: evidence.originalFileName,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    transactionReference: evidence.transactionReference,
    receivedAt: evidence.receivedAt,
    available: evidence.available,
    deletedAt: evidence.deletedAt,
  };
}

function publicOrderResult(order: OrderResult): OrderResult {
  return {
    id: order.id,
    orderId: order.orderId,
    customerId: order.customerId,
    subtotalCop: order.subtotalCop,
    deliveryFeeCop: order.deliveryFeeCop,
    totalCop: order.totalCop,
    status: order.status,
    reservationExpiresAt: order.reservationExpiresAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    lines: order.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPriceCop: line.unitPriceCop,
    })),
    paymentDecision:
      order.paymentDecision === null
        ? null
        : {
            decision: order.paymentDecision.decision,
            decidedAt: order.paymentDecision.decidedAt,
            reason: order.paymentDecision.reason,
          },
    cancellationRequest:
      order.cancellationRequest === null
        ? null
        : {
            requestedAt: order.cancellationRequest.requestedAt,
            resolvedAt: order.cancellationRequest.resolvedAt,
            resolution: order.cancellationRequest.resolution,
          },
  };
}

@Injectable()
export class OrderService {
  public constructor(
    @Inject(ORDER_FETCH) private readonly fetcher: typeof fetch,
    @Inject(ORDERS_SERVICE_URL) private readonly ordersServiceUrl: string,
    @Inject(ORDERS_INTERNAL_TOKEN) private readonly internalToken = "",
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
          ...this.evidenceActorHeaders(customerId, "CUSTOMER"),
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

  public async getOrderById(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<OrderResult> {
    this.validateOrderId(orderId);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      throw new NotFoundException("Order was not found");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.customerId !== customerId
      ) {
        throw new Error("Orders service returned an invalid order response");
      }
      return payload.data;
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid order response",
        { cause: error },
      );
    }
  }

  public async cancelOrder(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<OrderResult> {
    if (role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }
    this.validateOrderId(orderId);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      throw new NotFoundException("Order was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Order is no longer eligible for cancellation");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.customerId !== customerId ||
        payload.data.status !== "CANCELLED" ||
        payload.data.paymentDecision !== null
      ) {
        throw new Error("Orders service returned an invalid order cancellation");
      }
      return publicOrderResult(payload.data);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid order cancellation",
        { cause: error },
      );
    }
  }

  public async requestCancellation(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<OrderResult> {
    if (role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }
    this.validateOrderId(orderId);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}/cancellation-request`,
      {
        method: "POST",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      throw new NotFoundException("Order was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Order is no longer eligible for a cancellation request");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.customerId !== customerId ||
        payload.data.status !== "PAYMENT_REVIEW_PENDING" ||
        !payload.data.cancellationRequest
      ) {
        throw new Error("Orders service returned an invalid cancellation request");
      }
      return publicOrderResult(payload.data);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid cancellation request",
        { cause: error },
      );
    }
  }

  public async uploadPaymentEvidence(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    formData: FormData,
  ): Promise<PaymentEvidenceReceipt> {
    this.validateOrderId(orderId);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}/payment-evidence`,
      {
        method: "POST",
        headers: this.evidenceActorHeaders(customerId, role),
        body: formData,
        signal: AbortSignal.timeout(15_000),
      },
    );
    await this.throwEvidenceResponseError(response);

    try {
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isRecord(payload.data)) {
        throw new Error("Orders service returned an invalid evidence receipt");
      }
      const data = payload.data;
      if (
        data.orderId !== orderId ||
        typeof data.originalFileName !== "string" ||
        typeof data.contentType !== "string" ||
        typeof data.sizeBytes !== "number" ||
        !Number.isSafeInteger(data.sizeBytes) ||
        (data.transactionReference !== null &&
          typeof data.transactionReference !== "string") ||
        typeof data.receivedAt !== "string" ||
        data.status !== "PAYMENT_REVIEW_PENDING"
      ) {
        throw new Error("Orders service returned an invalid evidence receipt");
      }
      return {
        orderId,
        originalFileName: data.originalFileName,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
        transactionReference: data.transactionReference,
        receivedAt: data.receivedAt,
        status: "PAYMENT_REVIEW_PENDING",
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid payment evidence response",
        { cause: error },
      );
    }
  }

  public async getPaymentEvidence(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<PaymentEvidenceStream> {
    this.validateOrderId(orderId);
    return this.streamPaymentEvidence(
      `${this.ordersServiceUrl}/orders/${encodeURIComponent(orderId)}/payment-evidence`,
      customerId,
      role,
    );
  }

  public async listPendingPaymentReviews(
    customerId: string,
    role: CustomerRole,
  ): Promise<PaymentEvidenceReviewSummary[]> {
    this.requireStoreAdmin(role);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/payments`,
      {
        method: "GET",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    await this.throwAdminResponseError(response);

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.data) ||
        !payload.data.every(isPaymentEvidenceReviewSummary)
      ) {
        throw new Error("Orders service returned an invalid payment review queue");
      }
      return payload.data.map((entry) => ({
        orderId: entry.orderId,
        customerId: entry.customerId,
        totalCop: entry.totalCop,
        createdAt: entry.createdAt,
        reservationExpiresAt: entry.reservationExpiresAt,
        evidence: publicReviewMetadata(entry.evidence),
      }));
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid payment review queue",
        { cause: error },
      );
    }
  }

  public async listPendingCancellationRequests(
    customerId: string,
    role: CustomerRole,
  ): Promise<PendingCancellationRequest[]> {
    this.requireStoreAdmin(role);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/cancellation-requests`,
      {
        method: "GET",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    await this.throwAdminResponseError(response);
    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.data) ||
        !payload.data.every(isPendingCancellationRequest)
      ) {
        throw new Error("Orders service returned invalid cancellation requests");
      }
      return payload.data.map((entry) => ({
        orderId: entry.orderId,
        customerId: entry.customerId,
        totalCop: entry.totalCop,
        createdAt: entry.createdAt,
        requestedAt: entry.requestedAt,
        paymentCaptured: entry.paymentCaptured,
        refundHandledAt: entry.refundHandledAt,
        externalRefundReference: entry.externalRefundReference,
        refundRecordedByCustomerId: entry.refundRecordedByCustomerId,
      }));
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned invalid cancellation requests",
        { cause: error },
      );
    }
  }

  public async recordCancellationRefund(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    paymentCapturedInput: unknown,
    externalRefundReferenceInput: unknown,
  ): Promise<OrderResult> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    if (typeof paymentCapturedInput !== "boolean") {
      throw new BadRequestException("Payment capture status is required");
    }
    let externalRefundReference: string | null = null;
    if (paymentCapturedInput) {
      if (typeof externalRefundReferenceInput !== "string") {
        throw new BadRequestException("An external refund reference is required");
      }
      externalRefundReference = externalRefundReferenceInput.trim();
      if (!externalRefundReference || externalRefundReference.length > 200) {
        throw new BadRequestException("External refund reference must be 1 to 200 characters");
      }
    } else if (
      externalRefundReferenceInput !== undefined &&
      externalRefundReferenceInput !== null &&
      externalRefundReferenceInput !== ""
    ) {
      throw new BadRequestException("A refund reference is not allowed when payment was not captured");
    }
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/cancellation-requests/${encodeURIComponent(orderId)}/refund-handling`,
      {
        method: "POST",
        headers: {
          ...this.evidenceActorHeaders(customerId, role),
          "content-type": "application/json",
        },
        body: JSON.stringify({ paymentCaptured: paymentCapturedInput, externalRefundReference }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    await this.throwAdminResponseError(response);
    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.status !== "PAYMENT_REVIEW_PENDING" ||
        !payload.data.cancellationRequest ||
        payload.data.cancellationRequest.resolvedAt !== null
      ) {
        throw new Error("Orders service returned invalid refund handling");
      }
      return publicOrderResult(payload.data);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned invalid refund handling",
        { cause: error },
      );
    }
  }

  public async resolveCancellationRequest(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    actionInput: unknown,
    noteInput: unknown,
  ): Promise<OrderResult> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    if (actionInput !== "CANCEL" && actionInput !== "KEEP_OPEN") {
      throw new BadRequestException("A valid cancellation resolution is required");
    }
    if (typeof noteInput !== "string" || !noteInput.trim() || noteInput.trim().length > 1000) {
      throw new BadRequestException("A resolution note between 1 and 1000 characters is required");
    }
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/cancellation-requests/${encodeURIComponent(orderId)}/resolve`,
      {
        method: "POST",
        headers: {
          ...this.evidenceActorHeaders(customerId, role),
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: actionInput, note: noteInput.trim() }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      throw new NotFoundException("Cancellation request was not found");
    }
    if (response.status === 409) {
      throw new ConflictException(
        "Record the payment capture status and any required external refund before cancellation",
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }
    try {
      const payload: unknown = await response.json();
      const expectedStatus = actionInput === "CANCEL" ? "CANCELLED" : "PAYMENT_REVIEW_PENDING";
      const expectedResolution = actionInput === "CANCEL" ? "CANCELLED" : "KEPT_OPEN";
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.status !== expectedStatus ||
        payload.data.cancellationRequest?.resolution !== expectedResolution
      ) {
        throw new Error("Orders service returned an invalid cancellation resolution");
      }
      return publicOrderResult(payload.data);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid cancellation resolution",
        { cause: error },
      );
    }
  }

  public async getPendingPaymentReview(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<PaymentEvidenceReviewDetail> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/payments/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    await this.throwAdminResponseError(response);

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isPaymentEvidenceReviewDetail(payload.data) ||
        payload.data.order.orderId !== orderId
      ) {
        throw new Error("Orders service returned an invalid payment review detail");
      }
      return {
        order: publicOrderResult(payload.data.order),
        evidence: publicReviewMetadata(payload.data.evidence),
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid payment review detail",
        { cause: error },
      );
    }
  }

  public async approvePayment(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<OrderResult> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/payments/${encodeURIComponent(orderId)}/approve`,
      {
        method: "POST",
        headers: this.evidenceActorHeaders(customerId, role),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 403) {
      throw new ForbiddenException("Store administrator access is required");
    }
    if (response.status === 404) {
      throw new NotFoundException("Pending payment was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Payment is no longer eligible for approval");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        (payload.data.paymentDecision?.decision !== "APPROVED")
      ) {
        throw new Error("Orders service returned an invalid payment approval");
      }
      return publicOrderResult(payload.data);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid payment approval",
        { cause: error },
      );
    }
  }

  public async rejectPayment(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    reasonInput: unknown,
  ): Promise<OrderResult> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    if (typeof reasonInput !== "string") {
      throw new BadRequestException("A rejection reason is required");
    }
    const reason = reasonInput.trim();
    if (!reason || reason.length > 1000) {
      throw new BadRequestException("A rejection reason between 1 and 1000 characters is required");
    }

    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/payments/${encodeURIComponent(orderId)}/reject`,
      {
        method: "POST",
        headers: {
          ...this.evidenceActorHeaders(customerId, role),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 400) {
      throw new BadRequestException("Payment rejection request was rejected");
    }
    if (response.status === 403) {
      throw new ForbiddenException("Store administrator access is required");
    }
    if (response.status === 404) {
      throw new NotFoundException("Pending payment was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Payment is no longer eligible for rejection");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isOrderResult(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.status !== "CANCELLED" ||
        payload.data.paymentDecision?.decision !== "REJECTED" ||
        payload.data.paymentDecision.reason !== reason
      ) {
        throw new Error("Orders service returned an invalid payment rejection");
      }
      return publicOrderResult(payload.data);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid payment rejection",
        { cause: error },
      );
    }
  }

  public async getAdminPaymentEvidence(
    orderId: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<PaymentEvidenceStream> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    return this.streamPaymentEvidence(
      `${this.ordersServiceUrl}/admin/payments/${encodeURIComponent(orderId)}/evidence`,
      customerId,
      role,
    );
  }

  public async deleteAdminPaymentEvidence(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    confirmDownloaded: unknown,
  ): Promise<{ orderId: string; available: false; deletedAt: string }> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    if (confirmDownloaded !== true) {
      throw new BadRequestException(
        "Confirm that the payment evidence was downloaded and saved before deleting it",
      );
    }

    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/payments/${encodeURIComponent(orderId)}/evidence`,
      {
        method: "POST",
        headers: {
          ...this.evidenceActorHeaders(customerId, role),
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirmDownloaded: true }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 400) {
      throw new BadRequestException("Payment evidence deletion confirmation was rejected");
    }
    if (response.status === 403) {
      throw new ForbiddenException("Store administrator access is required");
    }
    if (response.status === 404) {
      throw new NotFoundException("Payment evidence was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Payment evidence cannot be deleted in its current state");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.available !== false ||
        typeof payload.data.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(payload.data.deletedAt))
      ) {
        throw new Error("Orders service returned an invalid evidence deletion response");
      }
      return {
        orderId,
        available: false,
        deletedAt: payload.data.deletedAt,
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid evidence deletion response",
        { cause: error },
      );
    }
  }

  public async placePaymentEvidenceLegalHold(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    reasonInput: unknown,
  ): Promise<{ orderId: string; legalHold: true; changed: boolean }> {
    return this.updatePaymentEvidenceLegalHold(
      orderId,
      customerId,
      role,
      reasonInput,
      true,
    );
  }

  public async releasePaymentEvidenceLegalHold(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    reasonInput: unknown,
  ): Promise<{ orderId: string; legalHold: false; changed: boolean }> {
    return this.updatePaymentEvidenceLegalHold(
      orderId,
      customerId,
      role,
      reasonInput,
      false,
    );
  }

  private async updatePaymentEvidenceLegalHold<T extends boolean>(
    orderId: string,
    customerId: string,
    role: CustomerRole,
    reasonInput: unknown,
    legalHold: T,
  ): Promise<{ orderId: string; legalHold: T; changed: boolean }> {
    this.requireStoreAdmin(role);
    this.validateOrderId(orderId);
    if (typeof reasonInput !== "string" || !reasonInput.trim() || reasonInput.trim().length > 1000) {
      throw new BadRequestException("A legal-hold reason between 1 and 1000 characters is required");
    }

    const response = await this.requestOrdersService(
      `${this.ordersServiceUrl}/admin/payment-evidence/${encodeURIComponent(orderId)}/legal-hold`,
      {
        method: legalHold ? "POST" : "DELETE",
        headers: {
          ...this.evidenceActorHeaders(customerId, role),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: reasonInput.trim() }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 400) {
      throw new BadRequestException("Legal-hold request was rejected");
    }
    if (response.status === 403) {
      throw new ForbiddenException("Store administrator access is required");
    }
    if (response.status === 404) {
      throw new NotFoundException("Payment evidence was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Payment evidence cannot change legal-hold state");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Orders service is unavailable");
    }

    try {
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.legalHold !== legalHold ||
        typeof payload.data.changed !== "boolean"
      ) {
        throw new Error("Orders service returned an invalid legal-hold response");
      }
      return {
        orderId,
        legalHold,
        changed: payload.data.changed,
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service returned an invalid legal-hold response",
        { cause: error },
      );
    }
  }

  private async requestOrdersService(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (error) {
      throw new ServiceUnavailableException(
        "Orders service is unavailable",
        { cause: error },
      );
    }
  }

  private async throwEvidenceResponseError(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }
    if (response.status === 400) {
      throw new BadRequestException("Payment evidence request was rejected");
    }
    if (response.status === 403) {
      throw new ForbiddenException("Payment evidence access is not permitted");
    }
    if (response.status === 404) {
      throw new NotFoundException("Payment evidence was not found");
    }
    if (response.status === 409) {
      throw new ConflictException("Payment evidence cannot be submitted for this order");
    }
    if (response.status === 413) {
      throw new PayloadTooLargeException("Payment evidence exceeds the 10 MiB limit");
    }
    throw new ServiceUnavailableException("Orders service is unavailable");
  }

  private async throwAdminResponseError(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }
    if (response.status === 403) {
      throw new ForbiddenException("Store administrator access is required");
    }
    if (response.status === 404) {
      throw new NotFoundException("Pending payment was not found");
    }
    throw new ServiceUnavailableException("Orders service is unavailable");
  }

  private async streamPaymentEvidence(
    url: string,
    customerId: string,
    role: CustomerRole,
  ): Promise<PaymentEvidenceStream> {
    const response = await this.requestOrdersService(url, {
      method: "GET",
      headers: this.evidenceActorHeaders(customerId, role),
      signal: AbortSignal.timeout(10_000),
    });
    await this.throwEvidenceResponseError(response);

    const contentType = response.headers.get("content-type");
    const contentDisposition = response.headers.get("content-disposition");
    const contentLength = Number(response.headers.get("content-length"));
    if (
      !response.body ||
      (contentType !== "application/pdf" &&
        contentType !== "image/jpeg" &&
        contentType !== "image/png") ||
      !contentDisposition?.startsWith("attachment;") ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0
    ) {
      throw new ServiceUnavailableException(
        "Orders service returned invalid payment evidence headers",
      );
    }

    return {
      stream: Readable.from(this.readBody(response.body)),
      contentType,
      contentDisposition,
      contentLength,
    };
  }

  private requireStoreAdmin(role: CustomerRole): void {
    if (role !== "STORE_ADMIN") {
      throw new ForbiddenException("Store administrator access is required");
    }
  }

  private evidenceActorHeaders(
    customerId: string,
    role: CustomerRole,
  ): Record<string, string> {
    if (this.internalToken.trim().length < 32) {
      throw new ServiceUnavailableException(
        "A strong gateway-to-orders token must be configured",
      );
    }
    return {
      "x-orders-internal-token": this.internalToken,
      "x-authenticated-customer-id": customerId,
      "x-authenticated-role": role,
    };
  }

  private validateOrderId(orderId: string): void {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(orderId)) {
      throw new BadRequestException("Invalid order ID");
    }
  }

  private async *readBody(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
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
