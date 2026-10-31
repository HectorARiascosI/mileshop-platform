import assert from "node:assert/strict";
import test from "node:test";

import { OrderService } from "../src/orders.service.js";

const key = "00000000-0000-4000-8000-000000000001";
const internalToken = "0123456789abcdef0123456789abcdef";
const input = {
  lines: [
    {
      productId: "p-1",
      sku: "SKU-01",
      name: "Botella térmica",
      quantity: 2,
      unitPriceCop: 65000,
    },
  ],
};

test("forwards the authenticated customer and idempotency key to orders service", async () => {
  const calls: Array<{
    url: string;
    payload: unknown;
    idempotencyKey: string | null;
    internalToken: string | null;
    customerId: string | null;
    role: string | null;
  }> = [];
  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
        internalToken: new Headers(init?.headers).get("x-orders-internal-token"),
        customerId: new Headers(init?.headers).get("x-authenticated-customer-id"),
        role: new Headers(init?.headers).get("x-authenticated-role"),
      });
      return new Response(
        JSON.stringify({
          data: {
            orderId: "order-123",
            subtotalCop: 130000,
            deliveryFeeCop: 12000,
            totalCop: 142000,
            status: "RESERVING_INVENTORY",
            reservationExpiresAt: "2026-10-29T06:00:00.000Z",
            paymentDecision: null,
            cancellationRequest: null,
            event: {
              eventType: "OrderCreated.v1",
              eventId: "order-123-created",
              occurredAt: "2026-10-29T00:00:00.000Z",
              aggregateId: "order-123",
              payload: {
                customerId: "customer-42",
                subtotalCop: 130000,
                deliveryFeeCop: 12000,
                totalCop: 142000,
                currency: "COP",
                lines: input.lines,
              },
            },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
    "http://orders-service.local",
    internalToken,
  );

  const result = await service.createOrder(input, "customer-42", key);

  assert.equal(result.orderId, "order-123");
  assert.equal(result.totalCop, 142000);
  assert.equal(result.event.payload.customerId, "customer-42");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://orders-service.local/orders");
  assert.equal(calls[0]?.idempotencyKey, key);
  assert.equal(calls[0]?.internalToken, internalToken);
  assert.equal(calls[0]?.customerId, "customer-42");
  assert.equal(calls[0]?.role, "CUSTOMER");
  assert.deepEqual(calls[0]?.payload, {
    customerId: "customer-42",
    lines: input.lines,
  });
});

test("retrieves a validated owner order and forwards internal identity headers", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const order = {
    id: "row-1",
    orderId: "order-123",
    customerId: "customer-42",
    subtotalCop: 130000,
    deliveryFeeCop: 12000,
    totalCop: 142000,
    status: "PAYMENT_REVIEW_PENDING",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:05:00.000Z",
    lines: [{
      ...input.lines[0]!,
      id: "line-1",
    }],
    paymentDecision: {
      decision: "REJECTED" as const,
      decidedAt: "2026-10-30T12:00:00.000Z",
      reason: "El comprobante no corresponde al total del pedido.",
    },
    cancellationRequest: null,
  };
  const service = new OrderService(
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ data: order }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    "http://orders-service.local",
    internalToken,
  );

  const result = await service.getOrderById("order-123", "customer-42", "CUSTOMER");

  assert.deepEqual(result, order);
  assert.equal(result.paymentDecision?.decision, "REJECTED");
  assert.equal(result.paymentDecision?.reason, "El comprobante no corresponde al total del pedido.");
  assert.equal(capturedUrl, "http://orders-service.local/orders/order-123");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-orders-internal-token"), internalToken);
  assert.equal(headers.get("x-authenticated-customer-id"), "customer-42");
  assert.equal(headers.get("x-authenticated-role"), "CUSTOMER");
});

test("accepts an expired reservation as a terminal owner order status", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({
      data: {
        id: "row-1",
        orderId: "order-expired",
        customerId: "customer-42",
        subtotalCop: 25000,
        deliveryFeeCop: 12000,
        totalCop: 37000,
        status: "RESERVATION_EXPIRED",
        reservationExpiresAt: "2026-10-30T06:00:00.000Z",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T06:00:01.000Z",
        lines: [{
          ...input.lines[0]!,
          id: "line-1",
        }],
        paymentDecision: null,
        cancellationRequest: null,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    "http://orders-service.local",
    internalToken,
  );

  const result = await service.getOrderById(
    "order-expired",
    "customer-42",
    "CUSTOMER",
  );

  assert.equal(result.status, "RESERVATION_EXPIRED");
});

test("cancels only the verified customer's order and validates the terminal response", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const service = new OrderService(
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        data: {
          id: "row-1",
          orderId: "order-123",
          customerId: "customer-42",
          subtotalCop: 130000,
          deliveryFeeCop: 12000,
          totalCop: 142000,
          status: "CANCELLED",
          reservationExpiresAt: "2026-10-30T06:00:00.000Z",
          createdAt: "2026-10-30T00:00:00.000Z",
          updatedAt: "2026-10-30T01:00:00.000Z",
          lines: [{ ...input.lines[0]!, id: "line-1" }],
          paymentDecision: null,
          cancellationRequest: null,
        },
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
    "http://orders-service.local",
    internalToken,
  );

  const result = await service.cancelOrder("order-123", "customer-42", "CUSTOMER");

  assert.equal(result.status, "CANCELLED");
  assert.equal(capturedUrl, "http://orders-service.local/orders/order-123/cancel");
  assert.equal(capturedInit?.method, "POST");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-authenticated-customer-id"), "customer-42");
  assert.equal(headers.get("x-authenticated-role"), "CUSTOMER");

  const adminOnly = new OrderService(
    async () => { throw new Error("Must not call Orders service"); },
    "http://orders-service.local",
    internalToken,
  );
  await assert.rejects(
    () => adminOnly.cancelOrder("order-123", "admin-42", "STORE_ADMIN"),
    { name: "NotFoundException" },
  );
});

test("maps an ineligible order cancellation to conflict", async () => {
  const service = new OrderService(
    async () => new Response(null, { status: 409 }),
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.cancelOrder("order-123", "customer-42", "CUSTOMER"),
    { name: "ConflictException" },
  );
});

test("proxies cancellation requests and audited admin refund/resolution actions", async () => {
  const calls: Array<{
    url: string;
    method: string | undefined;
    body: string | undefined;
    headers: Headers;
  }> = [];
  const order = {
    id: "row-1",
    orderId: "order-123",
    customerId: "customer-42",
    subtotalCop: 10_000,
    deliveryFeeCop: 12_000,
    totalCop: 22_000,
    status: "PAYMENT_REVIEW_PENDING",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:05:00.000Z",
    lines: [{ ...input.lines[0]!, id: "line-1" }],
    paymentDecision: null,
    cancellationRequest: {
      requestedAt: "2026-10-30T00:06:00.000Z",
      resolvedAt: null,
      resolution: null,
    },
  };
  const cancelledOrder = {
    ...order,
    status: "CANCELLED",
    updatedAt: "2026-10-30T00:08:00.000Z",
    cancellationRequest: {
      ...order.cancellationRequest,
      resolvedAt: "2026-10-30T00:08:00.000Z",
      resolution: "CANCELLED",
    },
  };
  const requestEntry = {
    orderId: "order-123",
    customerId: "customer-42",
    totalCop: 22_000,
    createdAt: order.createdAt,
    requestedAt: "2026-10-30T00:06:00.000Z",
    paymentCaptured: true,
    refundHandledAt: "2026-10-30T00:07:00.000Z",
    externalRefundReference: "refund-123",
    refundRecordedByCustomerId: "admin-42",
  };
  const responses = [
    new Response(JSON.stringify({ data: order }), { status: 201 }),
    new Response(JSON.stringify({ data: [requestEntry] }), { status: 200 }),
    new Response(JSON.stringify({ data: order }), { status: 201 }),
    new Response(JSON.stringify({ data: cancelledOrder }), { status: 201 }),
  ];
  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: new Headers(init?.headers),
      });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    "http://orders-service.local",
    internalToken,
  );

  assert.equal(
    (await service.requestCancellation("order-123", "customer-42", "CUSTOMER"))
      .cancellationRequest?.resolution,
    null,
  );
  assert.equal(
    (await service.listPendingCancellationRequests("admin-42", "STORE_ADMIN")).length,
    1,
  );
  await service.recordCancellationRefund(
    "order-123",
    "admin-42",
    "STORE_ADMIN",
    true,
    "refund-123",
  );
  assert.equal(
    (await service.resolveCancellationRequest(
      "order-123",
      "admin-42",
      "STORE_ADMIN",
      "CANCEL",
      "Refund was handled externally.",
    )).status,
    "CANCELLED",
  );

  assert.deepEqual(calls.map(({ url, method }) => ({ url, method })), [
    {
      url: "http://orders-service.local/orders/order-123/cancellation-request",
      method: "POST",
    },
    {
      url: "http://orders-service.local/admin/cancellation-requests",
      method: "GET",
    },
    {
      url: "http://orders-service.local/admin/cancellation-requests/order-123/refund-handling",
      method: "POST",
    },
    {
      url: "http://orders-service.local/admin/cancellation-requests/order-123/resolve",
      method: "POST",
    },
  ]);
  assert.deepEqual(JSON.parse(calls[2]!.body!), {
    paymentCaptured: true,
    externalRefundReference: "refund-123",
  });
  assert.deepEqual(JSON.parse(calls[3]!.body!), {
    action: "CANCEL",
    note: "Refund was handled externally.",
  });
  for (const call of calls) {
    assert.equal(call.headers.get("x-orders-internal-token"), internalToken);
  }
  assert.equal(calls[0]?.headers.get("x-authenticated-role"), "CUSTOMER");
  assert.equal(calls[1]?.headers.get("x-authenticated-role"), "STORE_ADMIN");
});

test("maps an inaccessible order and malformed order response safely", async () => {
  const notFound = new OrderService(
    async () => new Response(null, { status: 404 }),
    "http://orders-service.local",
    internalToken,
  );
  await assert.rejects(
    () => notFound.getOrderById("order-123", "customer-42", "CUSTOMER"),
    { name: "NotFoundException" },
  );

  const malformed = new OrderService(
    async () => new Response(JSON.stringify({ data: { orderId: "different-order" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    "http://orders-service.local",
    internalToken,
  );
  await assert.rejects(
    () => malformed.getOrderById("order-123", "customer-42", "CUSTOMER"),
    { name: "ServiceUnavailableException" },
  );

  const wrongOwner = new OrderService(
    async () => new Response(JSON.stringify({
      data: {
        id: "row-1",
        orderId: "order-123",
        customerId: "customer-99",
        subtotalCop: 130000,
        deliveryFeeCop: 12000,
        totalCop: 142000,
        status: "PAYMENT_REVIEW_PENDING",
        reservationExpiresAt: "2026-10-30T06:00:00.000Z",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T00:05:00.000Z",
        lines: [{
          ...input.lines[0]!,
          id: "line-1",
        }],
        paymentDecision: null,
        cancellationRequest: null,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    "http://orders-service.local",
    internalToken,
  );
  await assert.rejects(
    () => wrongOwner.getOrderById("order-123", "customer-42", "CUSTOMER"),
    { name: "ServiceUnavailableException" },
  );
});

test("rejects malformed order data before calling orders service", async () => {
  const service = new OrderService(
    async () => {
      throw new Error("The orders service must not be called");
    },
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.createOrder({ lines: [{ quantity: 0 }] }, "customer-42", key),
    { name: "BadRequestException" },
  );
});

test("requires a UUID idempotency key", async () => {
  const service = new OrderService(
    async () => new Response(null, { status: 201 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", undefined),
    { name: "BadRequestException" },
  );
});

test("maps an orders-service validation failure to HTTP 400", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "invalid" }), { status: 400 }),
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", key),
    { name: "BadRequestException" },
  );
});

test("maps an idempotency conflict from orders-service to HTTP 409", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "conflict" }), { status: 409 }),
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", key),
    { name: "ConflictException" },
  );
});

test("maps a network failure from orders-service to HTTP 503", async () => {
  const service = new OrderService(
    async () => {
      throw new TypeError("fetch failed");
    },
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.createOrder(input, "customer-42", key),
    { name: "ServiceUnavailableException" },
  );
});

test("approves payments only as a store admin and validates the orders response", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const approvedOrder = {
    id: "row-1",
    orderId: "order-123",
    customerId: "customer-42",
    subtotalCop: 130000,
    deliveryFeeCop: 12000,
    totalCop: 142000,
    status: "PAYMENT_APPROVED_FINALIZING",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:05:00.000Z",
    lines: [{ ...input.lines[0]!, id: "line-1" }],
    paymentDecision: {
      decision: "APPROVED",
      decidedAt: "2026-10-30T00:05:00.000Z",
      reason: null,
    },
    cancellationRequest: null,
  };
  const service = new OrderService(
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ data: approvedOrder }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.approvePayment("order-123", "customer-42", "CUSTOMER"),
    { name: "ForbiddenException" },
  );
  const result = await service.approvePayment("order-123", "admin-42", "STORE_ADMIN");

  assert.equal(result.status, "PAYMENT_APPROVED_FINALIZING");
  assert.equal(result.paymentDecision?.decision, "APPROVED");
  assert.equal(capturedUrl, "http://orders-service.local/admin/payments/order-123/approve");
  assert.equal(capturedInit?.method, "POST");
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-orders-internal-token"), internalToken);
  assert.equal(headers.get("x-authenticated-customer-id"), "admin-42");
  assert.equal(headers.get("x-authenticated-role"), "STORE_ADMIN");
});

test("rejects payments only as a store admin and forwards the normalized reason", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const rejectedOrder = {
    id: "row-1",
    orderId: "order-123",
    customerId: "customer-42",
    subtotalCop: 130000,
    deliveryFeeCop: 12000,
    totalCop: 142000,
    status: "CANCELLED",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:05:00.000Z",
    lines: [{ ...input.lines[0]!, id: "line-1" }],
    paymentDecision: {
      decision: "REJECTED",
      decidedAt: "2026-10-30T00:05:00.000Z",
      reason: "Receipt mismatch",
    },
    cancellationRequest: null,
  };
  const service = new OrderService(
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ data: rejectedOrder }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.rejectPayment("order-123", "customer-42", "CUSTOMER", "Receipt mismatch"),
    { name: "ForbiddenException" },
  );
  await assert.rejects(
    () => service.rejectPayment("order-123", "admin-42", "STORE_ADMIN", " "),
    { name: "BadRequestException" },
  );
  const result = await service.rejectPayment(
    "order-123",
    "admin-42",
    "STORE_ADMIN",
    "  Receipt mismatch  ",
  );

  assert.equal(result.status, "CANCELLED");
  assert.equal(result.paymentDecision?.decision, "REJECTED");
  assert.equal(capturedUrl, "http://orders-service.local/admin/payments/order-123/reject");
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { reason: "Receipt mismatch" });
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-orders-internal-token"), internalToken);
  assert.equal(headers.get("x-authenticated-customer-id"), "admin-42");
  assert.equal(headers.get("x-authenticated-role"), "STORE_ADMIN");
});

test("forwards proof multipart data with the verified customer context", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const service = new OrderService(
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        data: {
          orderId: "order-123",
          originalFileName: "receipt.pdf",
          contentType: "application/pdf",
          sizeBytes: 23,
          transactionReference: "transfer-9",
          receivedAt: "2026-10-30T00:00:00.000Z",
          status: "PAYMENT_REVIEW_PENDING",
        },
      }), { status: 201, headers: { "content-type": "application/json" } });
    },
    "http://orders-service.local",
    internalToken,
  );
  const formData = new FormData();
  formData.append("file", new Blob(["proof"], { type: "application/pdf" }), "receipt.pdf");
  formData.append("transactionReference", "transfer-9");

  const receipt = await service.uploadPaymentEvidence(
    "order-123",
    "customer-42",
    "CUSTOMER",
    formData,
  );

  assert.equal(receipt.originalFileName, "receipt.pdf");
  assert.equal(receipt.status, "PAYMENT_REVIEW_PENDING");
  assert.equal(capturedUrl, "http://orders-service.local/orders/order-123/payment-evidence");
  assert.ok(capturedInit?.body instanceof FormData);
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-orders-internal-token"), internalToken);
  assert.equal(headers.get("x-authenticated-customer-id"), "customer-42");
  assert.equal(headers.get("x-authenticated-role"), "CUSTOMER");
});

test("fails closed when the gateway-to-orders token is not configured", async () => {
  const service = new OrderService(
    async () => {
      throw new Error("The orders service must not be called");
    },
    "http://orders-service.local",
  );
  const formData = new FormData();

  await assert.rejects(
    () => service.uploadPaymentEvidence(
      "order-123",
      "customer-42",
      "CUSTOMER",
      formData,
    ),
    { name: "ServiceUnavailableException" },
  );
});

test("streams private proof responses and preserves private download headers", async () => {
  const service = new OrderService(
    async () => new Response(Buffer.from("private-proof"), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename*=UTF-8''receipt.pdf",
        "content-length": "13",
      },
    }),
    "http://orders-service.local",
    internalToken,
  );

  const evidence = await service.getPaymentEvidence("order-123", "customer-42", "CUSTOMER");
  const chunks: Buffer[] = [];
  for await (const chunk of evidence.stream) {
    chunks.push(Buffer.from(chunk));
  }

  assert.equal(Buffer.concat(chunks).toString(), "private-proof");
  assert.equal(evidence.contentType, "application/pdf");
  assert.equal(evidence.contentLength, 13);
  assert.match(evidence.contentDisposition, /^attachment;/);
});

test("does not proxy a proof for an order the service reports as inaccessible", async () => {
  const service = new OrderService(
    async () => new Response(null, { status: 404 }),
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.getPaymentEvidence("order-123", "customer-42", "CUSTOMER"),
    { name: "NotFoundException" },
  );
});

test("proxies validated admin payment queue, detail, and private evidence requests", async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const order = {
    id: "row-1",
    orderId: "order-123",
    customerId: "customer-42",
    subtotalCop: 10_000,
    deliveryFeeCop: 12_000,
    totalCop: 22_000,
    status: "PAYMENT_REVIEW_PENDING",
    reservationExpiresAt: "2026-10-30T06:00:00.000Z",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:04:00.000Z",
    lines: [{
      id: "line-1",
      productId: "p-1",
      sku: "SKU-01",
      name: "Bottle",
      quantity: 1,
      unitPriceCop: 10_000,
    }],
    paymentDecision: null,
    cancellationRequest: null,
  };
  const queueEntry = {
    orderId: "order-123",
    customerId: "customer-42",
    totalCop: 22_000,
    createdAt: order.createdAt,
    reservationExpiresAt: order.reservationExpiresAt,
    evidence: {
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 23,
      transactionReference: "transfer-9",
      receivedAt: "2026-10-30T00:04:00.000Z",
      available: true,
      deletedAt: null,
      storageKey: "must-not-leak",
    },
    storageKey: "must-not-leak",
  };
  const responses = [
    new Response(JSON.stringify({ data: [queueEntry] }), { status: 200 }),
    new Response(JSON.stringify({
      data: {
        order: { ...order, idempotencyKey: "must-not-leak" },
        evidence: queueEntry.evidence,
        storageKey: "must-not-leak",
      },
    }), { status: 200 }),
    new Response(Buffer.from("private-proof"), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename*=UTF-8''receipt.pdf",
        "content-length": "13",
      },
    }),
  ];
  const service = new OrderService(
    async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
    "http://orders-service.local",
    internalToken,
  );

  const queue = await service.listPendingPaymentReviews(
    "admin-42",
    "STORE_ADMIN",
  );
  assert.equal(queue[0]?.orderId, "order-123");
  assert.equal("storageKey" in queue[0]!.evidence, false);
  const detail = await service.getPendingPaymentReview(
    "order-123",
    "admin-42",
    "STORE_ADMIN",
  );
  assert.equal(detail.order.status, "PAYMENT_REVIEW_PENDING");
  assert.equal("idempotencyKey" in detail.order, false);
  assert.equal("storageKey" in detail.evidence, false);
  const evidence = await service.getAdminPaymentEvidence(
    "order-123",
    "admin-42",
    "STORE_ADMIN",
  );
  const chunks: Buffer[] = [];
  for await (const chunk of evidence.stream) {
    chunks.push(Buffer.from(chunk));
  }

  assert.equal(Buffer.concat(chunks).toString(), "private-proof");
  assert.deepEqual(calls.map(({ url }) => url), [
    "http://orders-service.local/admin/payments",
    "http://orders-service.local/admin/payments/order-123",
    "http://orders-service.local/admin/payments/order-123/evidence",
  ]);
  for (const call of calls) {
    assert.equal(call.headers.get("x-orders-internal-token"), internalToken);
    assert.equal(call.headers.get("x-authenticated-customer-id"), "admin-42");
    assert.equal(call.headers.get("x-authenticated-role"), "STORE_ADMIN");
  }

  await assert.rejects(
    () => service.listPendingPaymentReviews("customer-42", "CUSTOMER"),
    { name: "ForbiddenException" },
  );
  assert.equal(calls.length, 3);
});

test("deletes only an admin-confirmed downloaded evidence file", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const service = new OrderService(
    async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        data: {
          orderId: "order-123",
          available: false,
          deletedAt: "2026-10-30T12:00:00.000Z",
        },
      }), { status: 201, headers: { "content-type": "application/json" } });
    },
    "http://orders-service.local",
    internalToken,
  );

  await assert.rejects(
    () => service.deleteAdminPaymentEvidence(
      "order-123",
      "customer-42",
      "CUSTOMER",
      true,
    ),
    { name: "ForbiddenException" },
  );
  await assert.rejects(
    () => service.deleteAdminPaymentEvidence(
      "order-123",
      "admin-42",
      "STORE_ADMIN",
      false,
    ),
    { name: "BadRequestException" },
  );

  assert.deepEqual(
    await service.deleteAdminPaymentEvidence("order-123", "admin-42", "STORE_ADMIN", true),
    {
      orderId: "order-123",
      available: false,
      deletedAt: "2026-10-30T12:00:00.000Z",
    },
  );
  assert.equal(
    capturedUrl,
    "http://orders-service.local/admin/payments/order-123/evidence",
  );
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { confirmDownloaded: true });
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("x-authenticated-customer-id"), "admin-42");
  assert.equal(headers.get("x-authenticated-role"), "STORE_ADMIN");
});

test("rejects malformed admin review responses and maps missing details", async () => {
  const malformedQueue = new OrderService(
    async () => new Response(JSON.stringify({ data: [{ orderId: "bad" }] }), {
      status: 200,
    }),
    "http://orders-service.local",
    internalToken,
  );
  await assert.rejects(
    () => malformedQueue.listPendingPaymentReviews("admin-42", "STORE_ADMIN"),
    { name: "ServiceUnavailableException" },
  );

  const missingDetail = new OrderService(
    async () => new Response(null, { status: 404 }),
    "http://orders-service.local",
    internalToken,
  );
  await assert.rejects(
    () => missingDetail.getPendingPaymentReview(
      "order-123",
      "admin-42",
      "STORE_ADMIN",
    ),
    { name: "NotFoundException" },
  );
});

test("records and releases payment evidence legal holds through the trusted admin contract", async () => {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
  const service = new OrderService(
    async (url, init) => {
      const legalHold = init?.method === "POST";
      calls.push({
        url: String(url),
        method: String(init?.method),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
      });
      return new Response(JSON.stringify({
        data: { orderId: "order-123", legalHold, changed: true },
      }), { status: 200 });
    },
    "http://orders-service.local",
    internalToken,
  );

  assert.deepEqual(
    await service.placePaymentEvidenceLegalHold(
      "order-123",
      "admin-42",
      "STORE_ADMIN",
      "Active dispute",
    ),
    { orderId: "order-123", legalHold: true, changed: true },
  );
  assert.deepEqual(
    await service.releasePaymentEvidenceLegalHold(
      "order-123",
      "admin-42",
      "STORE_ADMIN",
      "Dispute resolved",
    ),
    { orderId: "order-123", legalHold: false, changed: true },
  );
  assert.deepEqual(calls.map(({ url, method, body }) => ({ url, method, body })), [
    {
      url: "http://orders-service.local/admin/payment-evidence/order-123/legal-hold",
      method: "POST",
      body: { reason: "Active dispute" },
    },
    {
      url: "http://orders-service.local/admin/payment-evidence/order-123/legal-hold",
      method: "DELETE",
      body: { reason: "Dispute resolved" },
    },
  ]);
  for (const call of calls) {
    assert.equal(call.headers.get("x-authenticated-customer-id"), "admin-42");
    assert.equal(call.headers.get("x-authenticated-role"), "STORE_ADMIN");
    assert.equal(call.headers.get("x-orders-internal-token"), internalToken);
  }

  await assert.rejects(
    () => service.placePaymentEvidenceLegalHold("order-123", "customer-1", "CUSTOMER", "Dispute"),
    { name: "ForbiddenException" },
  );
  await assert.rejects(
    () => service.releasePaymentEvidenceLegalHold("order-123", "admin-42", "STORE_ADMIN", ""),
    { name: "BadRequestException" },
  );
});
