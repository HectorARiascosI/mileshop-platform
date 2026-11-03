import assert from "node:assert/strict";
import test from "node:test";

import { OrderService } from "../src/orders.service.js";

test("forwards the order created result from the orders service", async () => {
  const calls: Array<{ url: string; payload: unknown; idempotencyKey: string | null }> = [];

  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined,
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      });

      if (url === "http://orders-service.local/orders") {
        return new Response(
          JSON.stringify({
            data: {
              orderId: "order-123",
              customerId: "customer-42",
              subtotalCop: 130000,
              deliveryFeeCop: 12000,
              totalCop: 142000,
              status: "PENDING",
              createdAt: "2026-10-29T00:00:00.000Z",
              updatedAt: "2026-10-29T00:00:00.000Z",
              lines: [
                {
                  productId: "p-1",
                  sku: "SKU-01",
                  name: "Botella térmica",
                  quantity: 2,
                  unitPriceCop: 65000,
                },
              ],
              event: {
                eventType: "OrderCreated.v1",
                eventId: "order-123-event-1",
                occurredAt: "2026-10-29T00:00:00.000Z",
                aggregateId: "order-123",
                payload: {
                  customerId: "customer-42",
                  subtotalCop: 130000,
                  deliveryFeeCop: 12000,
                  totalCop: 142000,
                  currency: "COP",
                  lines: [
                    {
                      productId: "p-1",
                      sku: "SKU-01",
                      name: "Botella térmica",
                      quantity: 2,
                      unitPriceCop: 65000,
                    },
                  ],
                },
              },
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
    "http://orders-service.local",
  );

  const result = await service.createOrder({
    lines: [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        quantity: 2,
        unitPriceCop: 65000,
      },
    ],
  }, "customer-42", "00000000-0000-4000-8000-000000000001");

  assert.equal(result.orderId.startsWith("order-"), true);
  assert.equal(result.subtotalCop, 130000);
  assert.equal(result.deliveryFeeCop, 12000);
  assert.equal(result.totalCop, 142000);
  assert.equal(result.event.eventType, "OrderCreated.v1");
  assert.equal(result.event.payload.customerId, "customer-42");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://orders-service.local/orders");
  assert.equal(calls[0]?.idempotencyKey, "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(calls[0]?.payload, {
    customerId: "customer-42",
    lines: [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        quantity: 2,
        unitPriceCop: 65000,
      },
    ],
  });
});

test("waits for order creation that takes longer than three seconds", async () => {
  const service = new OrderService(
    async (_url, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error("Order creation request must have a timeout signal");
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 3_250);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      });

      return new Response(
        JSON.stringify({
          data: {
            orderId: "order-slow-123",
            customerId: "customer-42",
            subtotalCop: 28000,
            deliveryFeeCop: 12000,
            totalCop: 40000,
            status: "AWAITING_PAYMENT_PROOF",
            createdAt: "2026-10-29T00:00:00.000Z",
            updatedAt: "2026-10-29T00:00:00.000Z",
            lines: [
              {
                productId: "p-1",
                sku: "SKU-01",
                name: "Taza de cerámica",
                quantity: 1,
                unitPriceCop: 28000,
              },
            ],
            event: {
              eventType: "OrderCreated.v1",
              eventId: "order-slow-123-created",
              occurredAt: "2026-10-29T00:00:00.000Z",
              aggregateId: "order-slow-123",
              payload: {
                customerId: "customer-42",
                totalCop: 40000,
                currency: "COP",
                lines: [],
              },
            },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
    "http://orders-service.local",
  );

  const result = await service.createOrder(
    { lines: [{ productId: "p-1", sku: "SKU-01", name: "Taza de cerámica", quantity: 1, unitPriceCop: 28000 }] },
    "customer-42",
    "00000000-0000-4000-8000-000000000005",
  );

  assert.equal(result.orderId, "order-slow-123");
});

test("maps an orders-service validation failure to HTTP 400", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "invalid" }), { status: 400 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(
      { lines: [] },
      "customer-42",
      "00000000-0000-4000-8000-000000000002",
    ),
    { name: "BadRequestException" },
  );
});

test("maps an idempotency conflict from orders-service to HTTP 409", async () => {
  const service = new OrderService(
    async () => new Response(JSON.stringify({ message: "conflict" }), { status: 409 }),
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(
      { lines: [] },
      "customer-42",
      "00000000-0000-4000-8000-000000000003",
    ),
    { name: "ConflictException" },
  );
});

test("maps a network failure from orders-service to HTTP 503", async () => {
  const service = new OrderService(
    async () => {
      throw new TypeError("fetch failed");
    },
    "http://orders-service.local",
  );

  await assert.rejects(
    () => service.createOrder(
      { lines: [] },
      "customer-42",
      "00000000-0000-4000-8000-000000000004",
    ),
    { name: "ServiceUnavailableException" },
  );
});

test("forwards admin payment reports to the orders service", async () => {
  let requestUrl = "";
  let requestMethod = "";
  let requestHeaders: Headers | undefined;
  const service = new OrderService(
    async (url, init) => {
      requestUrl = url;
      requestMethod = init?.method ?? "GET";
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        data: { result: "marked", order: { orderId: "order-123" } },
      }), { status: 200 });
    },
    "http://orders-service.local",
    "orders-internal-token",
  );

  const result = await service.markPaymentReported("admin-123", "order-123");

  assert.equal(requestUrl, "http://orders-service.local/admin/orders/order-123/payment-reported");
  assert.equal(requestMethod, "POST");
  assert.equal(requestHeaders?.get("x-authenticated-customer-id"), "admin-123");
  assert.equal(requestHeaders?.get("x-authenticated-role"), "STORE_ADMIN");
  assert.deepEqual(result, { result: "marked", order: { orderId: "order-123" } });
});

test("forwards payment-review and cancellation queues with trusted admin identity", async () => {
  const calls: Array<{ url: string; method: string; role: string | null }> = [];
  const service = new OrderService(
    async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        role: new Headers(init?.headers).get("x-authenticated-role"),
      });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
    "http://orders-service.local",
    "orders-internal-token",
  );

  assert.deepEqual(await service.listPendingPaymentReviews("admin-1", "STORE_ADMIN"), []);
  assert.deepEqual(await service.listPendingCancellationRequests("admin-1", "STORE_ADMIN"), []);
  assert.deepEqual(calls, [
    {
      url: "http://orders-service.local/admin/payments",
      method: "GET",
      role: "STORE_ADMIN",
    },
    {
      url: "http://orders-service.local/admin/cancellation-requests",
      method: "GET",
      role: "STORE_ADMIN",
    },
  ]);
});

test("forwards payment proof multipart data without overriding its boundary", async () => {
  let requestUrl = "";
  let requestBody: BodyInit | null | undefined;
  let requestHeaders: Headers | undefined;
  const service = new OrderService(
    async (url, init) => {
      requestUrl = url;
      requestBody = init?.body;
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: { uploaded: true } }), { status: 201 });
    },
    "http://orders-service.local",
    "orders-internal-token",
  );
  const form = new FormData();
  form.append("transactionReference", "transfer-123");
  form.append("file", new Blob(["proof"]), "proof.pdf");

  assert.deepEqual(await service.uploadPaymentEvidence("order-123", "customer-1", "CUSTOMER", form), {
    uploaded: true,
  });
  assert.equal(requestUrl, "http://orders-service.local/orders/order-123/payment-evidence");
  assert.equal(requestBody, form);
  assert.equal(requestHeaders?.get("content-type"), null);
  assert.equal(requestHeaders?.get("x-authenticated-customer-id"), "customer-1");
  assert.equal(requestHeaders?.get("x-authenticated-role"), "CUSTOMER");
});

test("streams payment evidence and preserves its response metadata", async () => {
  const service = new OrderService(
    async () => new Response(new Uint8Array([112, 100, 102]), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="proof.pdf"',
        "content-length": "3",
      },
    }),
    "http://orders-service.local",
    "orders-internal-token",
  );

  const evidence = await service.getAdminPaymentEvidence("order-123", "admin-1", "STORE_ADMIN");
  const chunks: Buffer[] = [];
  for await (const chunk of evidence.stream) {
    chunks.push(Buffer.from(chunk));
  }
  assert.equal(Buffer.concat(chunks).toString(), "pdf");
  assert.equal(evidence.contentType, "application/pdf");
  assert.equal(evidence.contentDisposition, 'attachment; filename="proof.pdf"');
  assert.equal(evidence.contentLength, 3);
});
