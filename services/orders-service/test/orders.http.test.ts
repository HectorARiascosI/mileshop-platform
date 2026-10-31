import assert from "node:assert/strict";
import test from "node:test";
import multipart from "@fastify/multipart";
import { Readable } from "node:stream";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import type { CatalogProduct } from "../src/catalog.reader.js";
import { OrdersController } from "../src/orders.controller.js";
import { InMemoryOrdersRepository } from "../src/orders.repository.js";
import { InvalidPaymentDecisionError, OrdersService } from "../src/orders.service.js";
import {
  GatewayInternalGuard,
  ORDERS_INTERNAL_TOKEN,
} from "../src/payment-evidence/gateway-internal.guard.js";
import { PaymentEvidenceValidationError } from "../src/payment-evidence/payment-evidence.storage.js";

const gatewayToken = "0123456789abcdef0123456789abcdef";

const product: CatalogProduct = {
  id: "p-1",
  sku: "SKU-01",
  name: "Botella térmica",
  description: "Producto de prueba",
  priceCop: 65_000,
  stock: 5,
};

test("POST /orders returns reservation status and expiry over HTTP", async () => {
  const service = new OrdersService(
    new InMemoryOrdersRepository(),
    { listActiveProducts: async () => [product] },
    { publishCreated: async () => undefined },
  );
  class OrdersHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      { provide: "ORDERS_SERVICE", useValue: service },
      {
        provide: "PAYMENT_EVIDENCE_SERVICE",
        useValue: {
          upload: async () => ({
            orderId: "order-1",
            originalFileName: "receipt.pdf",
            contentType: "application/pdf",
            sizeBytes: 23,
            transactionReference: null,
            receivedAt: "2026-10-30T00:00:00.000Z",
            status: "PAYMENT_REVIEW_PENDING",
          }),
          open: async () => ({
            metadata: {
              orderId: "order-1",
              storageKey: "opaque-key",
              originalFileName: "receipt.pdf",
              contentType: "application/pdf",
              sizeBytes: 13,
            },
            stream: Readable.from([Buffer.from("private-proof")]),
          }),
        },
      },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(OrdersHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    OrdersHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  });
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/orders`;
    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000001",
      },
      body: JSON.stringify({
        customerId: "customer-1",
        lines: [{
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: 1,
          unitPriceCop: product.priceCop,
        }],
      }),
    });
    assert.equal(unauthenticated.status, 401);

    const adminCreate = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000001",
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "admin-1",
        "x-authenticated-role": "STORE_ADMIN",
      },
      body: JSON.stringify({
        lines: [{
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: 1,
          unitPriceCop: product.priceCop,
        }],
      }),
    });
    assert.equal(adminCreate.status, 403);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "00000000-0000-4000-8000-000000000001",
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
      },
      body: JSON.stringify({
        customerId: "spoofed-customer",
        lines: [{
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: 1,
          unitPriceCop: product.priceCop,
        }],
      }),
    });
    assert.equal(response.status, 201);
    const payload: unknown = await response.json();
    assert.ok(payload !== null && typeof payload === "object" && "data" in payload);
    const data = payload.data;
    assert.ok(data !== null && typeof data === "object" && "status" in data);
    assert.equal(data.status, "RESERVING_INVENTORY");
    assert.ok("reservationExpiresAt" in data);
    assert.equal(typeof data.reservationExpiresAt, "string");

    const orderId = data.orderId;
    const baseUrl = await app.getUrl();
    const unauthorized = await fetch(`${baseUrl}/orders/${orderId}`);
    assert.equal(unauthorized.status, 401);

    const ownerOrder = await fetch(`${baseUrl}/orders/${orderId}`, {
      headers: {
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
        "x-orders-internal-token": gatewayToken,
      },
    });
    assert.equal(ownerOrder.status, 200);
    const ownerPayload = await ownerOrder.json() as {
      data: { customerId: string; paymentDecision: null };
    };
    assert.equal(ownerPayload.data.customerId, "customer-1");
    assert.equal(ownerPayload.data.paymentDecision, null);

    const otherOwnerOrder = await fetch(`${baseUrl}/orders/${orderId}`, {
      headers: {
        "x-authenticated-customer-id": "customer-2",
        "x-authenticated-role": "CUSTOMER",
        "x-orders-internal-token": gatewayToken,
      },
    });
    assert.equal(otherOwnerOrder.status, 404);
  } finally {
    await app.close();
  }
});

test("POST /orders/:orderId/cancel requires the trusted owner context", async () => {
  const calls: Array<{ orderId: string; customerId: string }> = [];
  const cancelledOrder = {
    orderId: "order-1",
    status: "CANCELLED",
    paymentDecision: null,
  };
  class CancellationHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      {
        provide: "ORDERS_SERVICE",
        useValue: {
          cancelOrder: async (orderId: string, customerId: string) => {
            calls.push({ orderId, customerId });
            return { result: "cancelled", order: cancelledOrder };
          },
        },
      },
      { provide: "PAYMENT_EVIDENCE_SERVICE", useValue: {} },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(CancellationHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    CancellationHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/orders/order-1/cancel`;
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const admin = await fetch(url, {
      method: "POST",
      headers: {
        "x-authenticated-customer-id": "admin-1",
        "x-authenticated-role": "STORE_ADMIN",
        "x-orders-internal-token": gatewayToken,
      },
    });
    assert.equal(admin.status, 404);

    const owner = await fetch(url, {
      method: "POST",
      headers: {
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
        "x-orders-internal-token": gatewayToken,
      },
    });
    assert.equal(owner.status, 201);
    assert.deepEqual(await owner.json(), { data: cancelledOrder });
    assert.equal(owner.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(calls, [{ orderId: "order-1", customerId: "customer-1" }]);
  } finally {
    await app.close();
  }
});

test("post-proof cancellation and admin resolution require trusted actor context", async () => {
  const calls: unknown[] = [];
  const pendingOrder = {
    orderId: "order-2",
    customerId: "customer-1",
    status: "PAYMENT_REVIEW_PENDING",
    cancellationRequest: {
      requestedAt: "2026-10-30T12:00:00.000Z",
      resolvedAt: null,
      resolution: null,
    },
  };
  class CancellationRequestHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      {
        provide: "ORDERS_SERVICE",
        useValue: {
          requestCancellation: async (orderId: string, customerId: string) => {
            calls.push({ operation: "request", orderId, customerId });
            return { result: "requested", order: pendingOrder };
          },
          listPendingCancellationRequests: async () => [{ orderId: "order-2" }],
          recordCancellationRefund: async (
            orderId: string,
            adminCustomerId: string,
            paymentCaptured: boolean,
            externalRefundReference: string | null,
          ) => {
            calls.push({
              operation: "refund",
              orderId,
              adminCustomerId,
              paymentCaptured,
              externalRefundReference,
            });
            return { result: "recorded", order: pendingOrder };
          },
          resolveCancellationRequest: async (
            orderId: string,
            adminCustomerId: string,
            action: string,
            note: string,
          ) => {
            calls.push({ operation: "resolve", orderId, adminCustomerId, action, note });
            return {
              result: action === "CANCEL" ? "cancelled" : "kept-open",
              order: {
                ...pendingOrder,
                status: action === "CANCEL" ? "CANCELLED" : "PAYMENT_REVIEW_PENDING",
                cancellationRequest: {
                  ...pendingOrder.cancellationRequest,
                  resolvedAt: "2026-10-30T12:02:00.000Z",
                  resolution: action === "CANCEL" ? "CANCELLED" : "KEPT_OPEN",
                },
              },
            };
          },
        },
      },
      { provide: "PAYMENT_EVIDENCE_SERVICE", useValue: {} },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(CancellationRequestHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    CancellationRequestHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const baseUrl = await app.getUrl();
    const trustedCustomerHeaders = {
      "x-authenticated-customer-id": "customer-1",
      "x-authenticated-role": "CUSTOMER",
      "x-orders-internal-token": gatewayToken,
    };
    const trustedAdminHeaders = {
      "x-authenticated-customer-id": "admin-1",
      "x-authenticated-role": "STORE_ADMIN",
      "x-orders-internal-token": gatewayToken,
    };

    assert.equal(
      (await fetch(`${baseUrl}/orders/order-2/cancellation-request`, {
        method: "POST",
      })).status,
      401,
    );
    const customerRequest = await fetch(
      `${baseUrl}/orders/order-2/cancellation-request`,
      { method: "POST", headers: trustedCustomerHeaders },
    );
    assert.equal(customerRequest.status, 201);
    assert.equal(customerRequest.headers.get("cache-control"), "private, no-store");

    assert.equal(
      (await fetch(`${baseUrl}/admin/cancellation-requests`, {
        headers: trustedCustomerHeaders,
      })).status,
      403,
    );
    const adminQueue = await fetch(`${baseUrl}/admin/cancellation-requests`, {
      headers: trustedAdminHeaders,
    });
    assert.equal(adminQueue.status, 200);

    const refund = await fetch(
      `${baseUrl}/admin/cancellation-requests/order-2/refund-handling`,
      {
        method: "POST",
        headers: { ...trustedAdminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          paymentCaptured: true,
          externalRefundReference: "refund-2",
        }),
      },
    );
    assert.equal(refund.status, 201);

    const resolution = await fetch(
      `${baseUrl}/admin/cancellation-requests/order-2/resolve`,
      {
        method: "POST",
        headers: { ...trustedAdminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", note: "Refund handled externally." }),
      },
    );
    assert.equal(resolution.status, 201);
    assert.deepEqual(calls, [
      { operation: "request", orderId: "order-2", customerId: "customer-1" },
      {
        operation: "refund",
        orderId: "order-2",
        adminCustomerId: "admin-1",
        paymentCaptured: true,
        externalRefundReference: "refund-2",
      },
      {
        operation: "resolve",
        orderId: "order-2",
        adminCustomerId: "admin-1",
        action: "CANCEL",
        note: "Refund handled externally.",
      },
    ]);
  } finally {
    await app.close();
  }
});

test("POST and GET payment evidence routes accept multipart and stream private files", async () => {
  const evidenceCalls: unknown[] = [];
  const evidenceService = {
    upload: async (
      orderId: string,
      actor: { customerId: string; role: string },
      file: { originalFileName: string; contentType: string; bytes: Uint8Array },
      reference: unknown,
    ) => {
      evidenceCalls.push({ orderId, actor, file, reference });
      return {
        orderId,
        originalFileName: file.originalFileName,
        contentType: file.contentType,
        sizeBytes: file.bytes.byteLength,
        transactionReference: reference ?? null,
        receivedAt: "2026-10-30T00:00:00.000Z",
        status: "PAYMENT_REVIEW_PENDING",
      };
    },
    open: async () => ({
      metadata: {
        orderId: "order-1",
        storageKey: "opaque-key",
        originalFileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 13,
      },
      stream: Readable.from([Buffer.from("private-proof")]),
    }),
  };
  class EvidenceHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      { provide: "ORDERS_SERVICE", useValue: {} },
      { provide: "PAYMENT_EVIDENCE_SERVICE", useValue: evidenceService },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(EvidenceHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    EvidenceHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  });
  await app.listen(0, "127.0.0.1");
  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob(["%PDF-1.7\nreceipt\n%%EOF\n"], { type: "application/pdf" }),
      "receipt.pdf",
    );
    const unauthenticated = await fetch(
      `${await app.getUrl()}/orders/order-1/payment-evidence`,
      { method: "POST" },
    );
    assert.equal(unauthenticated.status, 401);

    formData.append("transactionReference", "transfer-9");
    const upload = await fetch(`${await app.getUrl()}/orders/order-1/payment-evidence`, {
      method: "POST",
      headers: {
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
        "x-orders-internal-token": gatewayToken,
      },
      body: formData,
    });

    const uploadBody = await upload.text();
    assert.equal(upload.status, 201, uploadBody);
    assert.equal(evidenceCalls.length, 1);
    const receipt = JSON.parse(uploadBody) as {
      data: { transactionReference: string; receivedAt: string; status: string };
    };
    assert.equal(receipt.data.transactionReference, "transfer-9");
    assert.equal(receipt.data.status, "PAYMENT_REVIEW_PENDING");

    const oversizedForm = new FormData();
    oversizedForm.append(
      "file",
      new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "application/pdf" }),
      "large.pdf",
    );
    const oversized = await fetch(
      `${await app.getUrl()}/orders/order-1/payment-evidence`,
      {
        method: "POST",
        headers: {
          "x-authenticated-customer-id": "customer-1",
          "x-authenticated-role": "CUSTOMER",
          "x-orders-internal-token": gatewayToken,
        },
        body: oversizedForm,
      },
    );
    assert.equal(oversized.status, 413);
    assert.equal(evidenceCalls.length, 1);

    const download = await fetch(
      `${await app.getUrl()}/orders/order-1/payment-evidence`,
      {
        headers: {
          "x-authenticated-customer-id": "customer-1",
          "x-authenticated-role": "CUSTOMER",
          "x-orders-internal-token": gatewayToken,
        },
      },
    );
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(await download.text(), "private-proof");
  } finally {
    await app.close();
  }
});

test("admin payment queue, detail, and evidence routes require trusted admin context", async () => {
  const calls: Array<{ operation: string; orderId?: string; role: string }> = [];
  const evidenceService = {
    listPendingForAdmin: async (actor: { role: string }) => {
      calls.push({ operation: "queue", role: actor.role });
      return [{
        orderId: "order-1",
        customerId: "customer-1",
        totalCop: 22_000,
        createdAt: "2026-10-30T00:00:00.000Z",
        reservationExpiresAt: "2026-10-30T06:00:00.000Z",
        evidence: {
          originalFileName: "receipt.pdf",
          contentType: "application/pdf",
          sizeBytes: 23,
          transactionReference: "transfer-9",
          receivedAt: "2026-10-30T00:04:00.000Z",
          available: true,
          deletedAt: null,
        },
      }];
    },
    getPendingForAdmin: async (orderId: string, actor: { role: string }) => {
      calls.push({ operation: "detail", orderId, role: actor.role });
      return {
        order: { orderId, status: "PAYMENT_REVIEW_PENDING" },
        evidence: { originalFileName: "receipt.pdf" },
      };
    },
    open: async (_orderId: string, actor: { role: string }) => {
      calls.push({ operation: "evidence", orderId: "order-1", role: actor.role });
      return {
        metadata: {
          originalFileName: "receipt.pdf",
          contentType: "application/pdf",
          sizeBytes: 13,
        },
        stream: Readable.from([Buffer.from("private-proof")]),
      };
    },
    deleteAfterAdminDownload: async (
      orderId: string,
      actor: { role: string },
      confirmed: unknown,
    ) => {
      calls.push({ operation: "delete", orderId, role: actor.role });
      if (confirmed !== true) {
        throw new PaymentEvidenceValidationError("Explicit confirmation is required");
      }
      return {
        orderId,
        available: false,
        deletedAt: "2026-10-30T00:06:00.000Z",
      };
    },
  };
  class AdminPaymentHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      { provide: "ORDERS_SERVICE", useValue: {} },
      { provide: "PAYMENT_EVIDENCE_SERVICE", useValue: evidenceService },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(AdminPaymentHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    AdminPaymentHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const baseUrl = await app.getUrl();
    const queueUrl = `${baseUrl}/admin/payments`;
    const unauthorized = await fetch(queueUrl);
    assert.equal(unauthorized.status, 401);

    const customerHeaders = {
      "x-orders-internal-token": gatewayToken,
      "x-authenticated-customer-id": "customer-1",
      "x-authenticated-role": "CUSTOMER",
    };
    const forbidden = await fetch(queueUrl, { headers: customerHeaders });
    assert.equal(forbidden.status, 403);
    assert.equal(calls.length, 0);

    const adminHeaders = {
      "x-orders-internal-token": gatewayToken,
      "x-authenticated-customer-id": "admin-1",
      "x-authenticated-role": "STORE_ADMIN",
    };
    const queue = await fetch(queueUrl, { headers: adminHeaders });
    assert.equal(queue.status, 200);
    assert.equal(queue.headers.get("cache-control"), "private, no-store");
    const queueBody = await queue.json() as { data: Array<Record<string, unknown>> };
    assert.equal(queueBody.data[0]?.orderId, "order-1");

    const detail = await fetch(`${baseUrl}/admin/payments/order-1`, {
      headers: adminHeaders,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get("cache-control"), "private, no-store");

    const download = await fetch(`${baseUrl}/admin/payments/order-1/evidence`, {
      headers: adminHeaders,
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await download.text(), "private-proof");
    const invalidDelete = await fetch(`${baseUrl}/admin/payments/order-1/evidence`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ confirmDownloaded: false }),
    });
    assert.equal(invalidDelete.status, 400);
    const deleteEvidence = await fetch(`${baseUrl}/admin/payments/order-1/evidence`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ confirmDownloaded: true }),
    });
    assert.equal(deleteEvidence.status, 201);
    assert.equal(deleteEvidence.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await deleteEvidence.json(), {
      data: {
        orderId: "order-1",
        available: false,
        deletedAt: "2026-10-30T00:06:00.000Z",
      },
    });
    assert.deepEqual(calls, [
      { operation: "queue", role: "STORE_ADMIN" },
      { operation: "detail", orderId: "order-1", role: "STORE_ADMIN" },
      { operation: "evidence", orderId: "order-1", role: "STORE_ADMIN" },
      { operation: "delete", orderId: "order-1", role: "STORE_ADMIN" },
      { operation: "delete", orderId: "order-1", role: "STORE_ADMIN" },
    ]);
  } finally {
    await app.close();
  }
});

test("admin payment approval requires trusted admin identity and returns idempotent approval", async () => {
  const actors: string[] = [];
  class ApprovalHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      {
        provide: "ORDERS_SERVICE",
        useValue: {
          approvePayment: async (orderId: string, adminCustomerId: string) => {
            actors.push(adminCustomerId);
            return {
              result: "approved",
              order: {
                id: "row-1",
                orderId,
                customerId: "customer-1",
                subtotalCop: 10_000,
                deliveryFeeCop: 12_000,
                totalCop: 22_000,
                status: "PAYMENT_APPROVED_FINALIZING",
                reservationExpiresAt: "2026-10-30T06:00:00.000Z",
                createdAt: "2026-10-30T00:00:00.000Z",
                updatedAt: "2026-10-30T00:05:00.000Z",
                lines: [],
                paymentDecision: {
                  decision: "APPROVED",
                  decidedAt: "2026-10-30T00:05:00.000Z",
                  reason: null,
                },
              },
            };
          },
        },
      },
      { provide: "PAYMENT_EVIDENCE_SERVICE", useValue: {} },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(ApprovalHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    ApprovalHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/admin/payments/order-1/approve`;
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    const customer = await fetch(url, {
      method: "POST",
      headers: {
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
      },
    });
    assert.equal(customer.status, 403);
    assert.equal(actors.length, 0);

    const admin = await fetch(url, {
      method: "POST",
      headers: {
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "admin-1",
        "x-authenticated-role": "STORE_ADMIN",
      },
    });
    assert.equal(admin.status, 201);
    assert.equal(admin.headers.get("cache-control"), "private, no-store");
    const body = await admin.json() as { data: { status: string } };
    assert.equal(body.data.status, "PAYMENT_APPROVED_FINALIZING");
    assert.deepEqual(actors, ["admin-1"]);
  } finally {
    await app.close();
  }
});

test("admin payment rejection requires trusted admin identity and a reason", async () => {
  const actors: Array<{ adminId: string; reason: unknown }> = [];
  class RejectionHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      {
        provide: "ORDERS_SERVICE",
        useValue: {
          rejectPayment: async (
            orderId: string,
            adminId: string,
            reason: unknown,
          ) => {
            if (typeof reason !== "string" || !reason.trim()) {
              throw new InvalidPaymentDecisionError("A rejection reason is required");
            }
            actors.push({ adminId, reason });
            return {
              result: "rejected",
              order: {
                id: "row-1",
                orderId,
                customerId: "customer-1",
                subtotalCop: 10_000,
                deliveryFeeCop: 12_000,
                totalCop: 22_000,
                status: "CANCELLED",
                reservationExpiresAt: "2026-10-30T06:00:00.000Z",
                createdAt: "2026-10-30T00:00:00.000Z",
                updatedAt: "2026-10-30T00:05:00.000Z",
                lines: [],
                paymentDecision: {
                  decision: "REJECTED",
                  decidedAt: "2026-10-30T00:05:00.000Z",
                  reason,
                },
              },
            };
          },
        },
      },
      { provide: "PAYMENT_EVIDENCE_SERVICE", useValue: {} },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(RejectionHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    RejectionHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/admin/payments/order-1/reject`;
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const customer = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
      },
      body: JSON.stringify({ reason: "Invalid receipt" }),
    });
    assert.equal(customer.status, 403);
    assert.equal(actors.length, 0);

    const emptyReason = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "admin-1",
        "x-authenticated-role": "STORE_ADMIN",
      },
      body: JSON.stringify({ reason: "  " }),
    });
    assert.equal(emptyReason.status, 400);

    const admin = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "admin-1",
        "x-authenticated-role": "STORE_ADMIN",
      },
      body: JSON.stringify({ reason: "El comprobante no coincide." }),
    });
    assert.equal(admin.status, 201);
    assert.equal(admin.headers.get("cache-control"), "private, no-store");
    const body = await admin.json() as {
      data: { status: string; paymentDecision: { decision: string; reason: string } };
    };
    assert.equal(body.data.status, "CANCELLED");
    assert.equal(body.data.paymentDecision.decision, "REJECTED");
    assert.equal(body.data.paymentDecision.reason, "El comprobante no coincide.");
    assert.deepEqual(actors, [{
      adminId: "admin-1",
      reason: "El comprobante no coincide.",
    }]);
  } finally {
    await app.close();
  }
});

test("legal-hold routes require a trusted admin and retain an audit reason", async () => {
  const calls: Array<{ orderId: string; actor: string; reason: string }> = [];
  class LegalHoldHttpTestModule {}
  Module({
    controllers: [OrdersController],
    providers: [
      { provide: "ORDERS_SERVICE", useValue: {} },
      {
        provide: "PAYMENT_EVIDENCE_SERVICE",
        useValue: {
          placeLegalHold: async (orderId: string, actor: { customerId: string }, reason: string) => {
            calls.push({ orderId, actor: actor.customerId, reason });
            return { orderId, legalHold: true, changed: true };
          },
          releaseLegalHold: async (orderId: string, actor: { customerId: string }, reason: string) => {
            calls.push({ orderId, actor: actor.customerId, reason });
            return { orderId, legalHold: false, changed: true };
          },
        },
      },
      { provide: ORDERS_INTERNAL_TOKEN, useValue: gatewayToken },
      GatewayInternalGuard,
    ],
  })(LegalHoldHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    LegalHoldHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/admin/payment-evidence/order-1/legal-hold`;
    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Active dispute" }),
    });
    assert.equal(unauthenticated.status, 401);

    const customer = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orders-internal-token": gatewayToken,
        "x-authenticated-customer-id": "customer-1",
        "x-authenticated-role": "CUSTOMER",
      },
      body: JSON.stringify({ reason: "Active dispute" }),
    });
    assert.equal(customer.status, 403);
    assert.deepEqual(calls, []);

    const adminHeaders = {
      "content-type": "application/json",
      "x-orders-internal-token": gatewayToken,
      "x-authenticated-customer-id": "admin-1",
      "x-authenticated-role": "STORE_ADMIN",
    };
    const held = await fetch(url, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ reason: "Active dispute" }),
    });
    assert.equal(held.status, 201);
    assert.equal(held.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await held.json(), {
      data: { orderId: "order-1", legalHold: true, changed: true },
    });

    const released = await fetch(url, {
      method: "DELETE",
      headers: adminHeaders,
      body: JSON.stringify({ reason: "Dispute resolved" }),
    });
    assert.equal(released.status, 200);
    assert.deepEqual(await released.json(), {
      data: { orderId: "order-1", legalHold: false, changed: true },
    });
    assert.deepEqual(calls, [
      { orderId: "order-1", actor: "admin-1", reason: "Active dispute" },
      { orderId: "order-1", actor: "admin-1", reason: "Dispute resolved" },
    ]);
  } finally {
    await app.close();
  }
});
