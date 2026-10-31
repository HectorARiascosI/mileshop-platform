import assert from "node:assert/strict";
import test from "node:test";
import multipart from "@fastify/multipart";
import { Readable } from "node:stream";
import { Module, type MiddlewareConsumer, type NestModule, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AuthMiddleware, IDENTITY_SERVICE_URL } from "../src/auth.middleware.js";
import { CatalogClient } from "../src/catalog.client.js";
import { GatewayController } from "../src/gateway.controller.js";
import { IdentityClient } from "../src/identity.client.js";
import { OrderService } from "../src/orders.service.js";
import { StoreAdminGuard } from "../src/store-admin.guard.js";

test("admin evidence deletion requires a verified store-admin role", async () => {
  const calls: unknown[] = [];
  let verifiedRole = "CUSTOMER";
  const orderService = {
    deleteAdminPaymentEvidence: async (
      orderId: string,
      customerId: string,
      role: string,
      confirmation: unknown,
    ) => {
      calls.push({ orderId, customerId, role, confirmation });
      return {
        orderId,
        available: false,
        deletedAt: "2026-10-30T12:00:00.000Z",
      };
    },
  };
  class EvidenceDeletionGatewayModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AuthMiddleware).forRoutes({
        path: "admin/payments/:orderId/evidence",
        method: RequestMethod.POST,
      });
    }
  }
  Module({
    controllers: [GatewayController],
    providers: [
      { provide: CatalogClient, useValue: {} },
      { provide: IdentityClient, useValue: {} },
      { provide: OrderService, useValue: orderService },
      {
        provide: "AUTH_FETCH",
        useValue: async () => new Response(JSON.stringify({
          customerId: "admin-1",
          email: "admin@example.test",
          role: verifiedRole,
        }), { status: 200 }),
      },
      { provide: IDENTITY_SERVICE_URL, useValue: "http://identity.local" },
      AuthMiddleware,
      StoreAdminGuard,
    ],
  })(EvidenceDeletionGatewayModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    EvidenceDeletionGatewayModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/admin/payments/order-1/evidence`;
    const unauthenticated = await fetch(url, { method: "POST" });
    assert.equal(unauthenticated.status, 401);

    const headers = {
      authorization: "Bearer verified-session",
      "content-type": "application/json",
    };
    const customer = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmDownloaded: true }),
    });
    assert.equal(customer.status, 403);
    assert.equal(calls.length, 0);

    verifiedRole = "STORE_ADMIN";
    const admin = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmDownloaded: true }),
    });
    assert.equal(admin.status, 201);
    assert.deepEqual(await admin.json(), {
      data: {
        orderId: "order-1",
        available: false,
        deletedAt: "2026-10-30T12:00:00.000Z",
      },
    });
    assert.deepEqual(calls, [{
      orderId: "order-1",
      customerId: "admin-1",
      role: "STORE_ADMIN",
      confirmation: true,
    }]);
  } finally {
    await app.close();
  }
});

test("order cancellation route requires the verified customer and forwards its identity", async () => {
  const calls: unknown[] = [];
  let verifiedRole = "CUSTOMER";
  const orderService = {
    cancelOrder: async (orderId: string, customerId: string, role: string) => {
      calls.push({ orderId, customerId, role });
      return {
        orderId,
        customerId,
        status: "CANCELLED",
        paymentDecision: null,
      };
    },
  };
  class OrderCancellationGatewayModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AuthMiddleware).forRoutes({
        path: "orders/:orderId/cancel",
        method: RequestMethod.POST,
      });
    }
  }
  Module({
    controllers: [GatewayController],
    providers: [
      { provide: CatalogClient, useValue: {} },
      { provide: IdentityClient, useValue: {} },
      { provide: OrderService, useValue: orderService },
      {
        provide: "AUTH_FETCH",
        useValue: async () => new Response(JSON.stringify({
          customerId: "customer-1",
          email: "customer@example.test",
          role: verifiedRole,
        }), { status: 200 }),
      },
      { provide: IDENTITY_SERVICE_URL, useValue: "http://identity.local" },
      AuthMiddleware,
      StoreAdminGuard,
    ],
  })(OrderCancellationGatewayModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    OrderCancellationGatewayModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/orders/order-1/cancel`;
    const unauthenticated = await fetch(url, { method: "POST" });
    assert.equal(unauthenticated.status, 401);

    const owner = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer customer-token" },
    });
    assert.equal(owner.status, 201);
    assert.equal(owner.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await owner.json(), {
      data: {
        orderId: "order-1",
        customerId: "customer-1",
        status: "CANCELLED",
        paymentDecision: null,
      },
    });
    assert.deepEqual(calls, [{
      orderId: "order-1",
      customerId: "customer-1",
      role: "CUSTOMER",
    }]);

    verifiedRole = "STORE_ADMIN";
    const admin = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer admin-token" },
    });
    assert.equal(admin.status, 404);
    assert.equal(calls.length, 1);
  } finally {
    await app.close();
  }
});

test("post-proof cancellation routes enforce verified customer and admin roles", async () => {
  const calls: unknown[] = [];
  let verifiedRole = "CUSTOMER";
  const pendingOrder = {
    orderId: "order-2",
    customerId: "customer-1",
    status: "PAYMENT_REVIEW_PENDING",
    cancellationRequest: { requestedAt: "2026-10-30T12:00:00.000Z" },
  };
  const orderService = {
    requestCancellation: async (orderId: string, customerId: string, role: string) => {
      calls.push({ operation: "request", orderId, customerId, role });
      return pendingOrder;
    },
    listPendingCancellationRequests: async (
      customerId: string,
      role: string,
    ) => {
      calls.push({ operation: "list", customerId, role });
      return [{ orderId: "order-2" }];
    },
    recordCancellationRefund: async (
      orderId: string,
      customerId: string,
      role: string,
      paymentCaptured: boolean,
      refundReference: string,
    ) => {
      calls.push({ operation: "refund", orderId, customerId, role, paymentCaptured, refundReference });
      return pendingOrder;
    },
    resolveCancellationRequest: async (
      orderId: string,
      customerId: string,
      role: string,
      action: string,
      note: string,
    ) => {
      calls.push({ operation: "resolve", orderId, customerId, role, action, note });
      return pendingOrder;
    },
  };
  class PostProofCancellationGatewayModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AuthMiddleware).forRoutes(
        { path: "orders/:orderId/cancellation-request", method: RequestMethod.POST },
        { path: "admin/cancellation-requests", method: RequestMethod.GET },
        {
          path: "admin/cancellation-requests/:orderId/refund-handling",
          method: RequestMethod.POST,
        },
        {
          path: "admin/cancellation-requests/:orderId/resolve",
          method: RequestMethod.POST,
        },
      );
    }
  }
  Module({
    controllers: [GatewayController],
    providers: [
      { provide: CatalogClient, useValue: {} },
      { provide: IdentityClient, useValue: {} },
      { provide: OrderService, useValue: orderService },
      {
        provide: "AUTH_FETCH",
        useValue: async () => new Response(JSON.stringify({
          customerId: verifiedRole === "CUSTOMER" ? "customer-1" : "admin-1",
          email: "actor@example.test",
          role: verifiedRole,
        }), { status: 200 }),
      },
      { provide: IDENTITY_SERVICE_URL, useValue: "http://identity.local" },
      AuthMiddleware,
      StoreAdminGuard,
    ],
  })(PostProofCancellationGatewayModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    PostProofCancellationGatewayModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.listen(0, "127.0.0.1");
  try {
    const baseUrl = await app.getUrl();
    const request = await fetch(`${baseUrl}/orders/order-2/cancellation-request`, {
      method: "POST",
      headers: { authorization: "Bearer customer-token" },
    });
    assert.equal(request.status, 201);

    const customerAdminQueue = await fetch(`${baseUrl}/admin/cancellation-requests`, {
      headers: { authorization: "Bearer customer-token" },
    });
    assert.equal(customerAdminQueue.status, 403);

    verifiedRole = "STORE_ADMIN";
    const adminHeaders = {
      authorization: "Bearer admin-token",
      "content-type": "application/json",
    };
    const queue = await fetch(`${baseUrl}/admin/cancellation-requests`, {
      headers: adminHeaders,
    });
    assert.equal(queue.status, 200);
    const refund = await fetch(
      `${baseUrl}/admin/cancellation-requests/order-2/refund-handling`,
      {
        method: "POST",
        headers: adminHeaders,
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
        headers: adminHeaders,
        body: JSON.stringify({ action: "KEEP_OPEN", note: "Continue order." }),
      },
    );
    assert.equal(resolution.status, 201);
    assert.deepEqual(calls, [
      {
        operation: "request",
        orderId: "order-2",
        customerId: "customer-1",
        role: "CUSTOMER",
      },
      { operation: "list", customerId: "admin-1", role: "STORE_ADMIN" },
      {
        operation: "refund",
        orderId: "order-2",
        customerId: "admin-1",
        role: "STORE_ADMIN",
        paymentCaptured: true,
        refundReference: "refund-2",
      },
      {
        operation: "resolve",
        orderId: "order-2",
        customerId: "admin-1",
        role: "STORE_ADMIN",
        action: "KEEP_OPEN",
        note: "Continue order.",
      },
    ]);
  } finally {
    await app.close();
  }
});

test("payment evidence routes require verified identity and proxy private upload/download", async () => {
  const calls: unknown[] = [];
  let verifiedRole = "CUSTOMER";
  const orders = {
    uploadPaymentEvidence: async (
      orderId: string,
      customerId: string,
      role: string,
      form: FormData,
    ) => {
      calls.push({ operation: "upload", orderId, customerId, role, file: form.get("file") });
      return {
        orderId,
        originalFileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 23,
        transactionReference: "transfer-9",
        receivedAt: "2026-10-30T00:00:00.000Z",
        status: "PAYMENT_REVIEW_PENDING",
      };
    },
    getPaymentEvidence: async (orderId: string, customerId: string, role: string) => {
      calls.push({ operation: "download", orderId, customerId, role });
      return {
        stream: Readable.from([Buffer.from("private-proof")]),
        contentType: "application/pdf",
        contentDisposition: "attachment; filename*=UTF-8''receipt.pdf",
        contentLength: 13,
      };
    },
    getOrderById: async (orderId: string, customerId: string, role: string) => {
      calls.push({ operation: "order", orderId, customerId, role });
      return {
        id: "row-1",
        orderId,
        customerId,
        subtotalCop: 10000,
        deliveryFeeCop: 12000,
        totalCop: 22000,
        status: "AWAITING_PAYMENT_PROOF",
        reservationExpiresAt: "2026-10-30T06:00:00.000Z",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T00:00:00.000Z",
        lines: [{
          id: "line-1",
          productId: "p-1",
          sku: "SKU-01",
          name: "Bottle",
          quantity: 1,
          unitPriceCop: 10000,
        }],
        paymentDecision: null,
      };
    },
    listPendingPaymentReviews: async (customerId: string, role: string) => {
      calls.push({ operation: "admin-queue", customerId, role });
      return [{
        orderId: "order-1",
        customerId: "customer-2",
        totalCop: 22_000,
        createdAt: "2026-10-30T00:00:00.000Z",
        reservationExpiresAt: "2026-10-30T06:00:00.000Z",
        evidence: {
          originalFileName: "receipt.pdf",
          contentType: "application/pdf",
          sizeBytes: 23,
          transactionReference: "transfer-9",
          receivedAt: "2026-10-30T00:04:00.000Z",
        },
      }];
    },
    getPendingPaymentReview: async (
      orderId: string,
      customerId: string,
      role: string,
    ) => {
      calls.push({ operation: "admin-detail", orderId, customerId, role });
      return {
        order: { orderId, status: "PAYMENT_REVIEW_PENDING" },
        evidence: { originalFileName: "receipt.pdf" },
      };
    },
    getAdminPaymentEvidence: async (
      orderId: string,
      customerId: string,
      role: string,
    ) => {
      calls.push({ operation: "admin-evidence", orderId, customerId, role });
      return {
        stream: Readable.from([Buffer.from("admin-proof")]),
        contentType: "application/pdf",
        contentDisposition: "attachment; filename*=UTF-8''receipt.pdf",
        contentLength: 11,
      };
    },
    approvePayment: async (orderId: string, customerId: string, role: string) => {
      calls.push({ operation: "approve", orderId, customerId, role });
      return {
        orderId,
        status: "PAYMENT_APPROVED_FINALIZING",
        paymentDecision: { decision: "APPROVED" },
      };
    },
    rejectPayment: async (
      orderId: string,
      customerId: string,
      role: string,
      reason: string,
    ) => {
      calls.push({ operation: "reject", orderId, customerId, role, reason });
      return {
        orderId,
        status: "CANCELLED",
        paymentDecision: { decision: "REJECTED", reason },
      };
    },
    placePaymentEvidenceLegalHold: async (
      orderId: string,
      customerId: string,
      role: string,
      reason: string,
    ) => {
      calls.push({ operation: "place-legal-hold", orderId, customerId, role, reason });
      return { orderId, legalHold: true, changed: true };
    },
    releasePaymentEvidenceLegalHold: async (
      orderId: string,
      customerId: string,
      role: string,
      reason: string,
    ) => {
      calls.push({ operation: "release-legal-hold", orderId, customerId, role, reason });
      return { orderId, legalHold: false, changed: true };
    },
  };

  class GatewayHttpTestModule implements NestModule {
    public configure(consumer: MiddlewareConsumer): void {
      consumer.apply(AuthMiddleware).forRoutes(
        { path: "orders/:orderId/payment-evidence", method: RequestMethod.POST },
        { path: "orders/:orderId/payment-evidence", method: RequestMethod.GET },
        { path: "orders/:orderId", method: RequestMethod.GET },
        { path: "admin/payments", method: RequestMethod.GET },
        { path: "admin/payments/:orderId", method: RequestMethod.GET },
        { path: "admin/payments/:orderId/evidence", method: RequestMethod.GET },
        { path: "admin/payments/:orderId/approve", method: RequestMethod.POST },
        { path: "admin/payments/:orderId/reject", method: RequestMethod.POST },
        { path: "admin/payment-evidence/:orderId/legal-hold", method: RequestMethod.POST },
        { path: "admin/payment-evidence/:orderId/legal-hold", method: RequestMethod.DELETE },
      );
    }
  }
  Module({
    controllers: [GatewayController],
    providers: [
      { provide: CatalogClient, useValue: {} },
      { provide: IdentityClient, useValue: {} },
      { provide: OrderService, useValue: orders },
      {
        provide: "AUTH_FETCH",
        useValue: async () => new Response(JSON.stringify({
          customerId: "customer-1",
          email: "customer@example.test",
          role: verifiedRole,
        }), { status: 200 }),
      },
      { provide: IDENTITY_SERVICE_URL, useValue: "http://identity.local" },
      AuthMiddleware,
      StoreAdminGuard,
    ],
  })(GatewayHttpTestModule);

  const app = await NestFactory.create<NestFastifyApplication>(
    GatewayHttpTestModule,
    new FastifyAdapter(),
    { logger: ["error", "warn"] },
  );
  await app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  });
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/orders/order-1/payment-evidence`;
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    const unauthorizedOrder = await fetch(`${await app.getUrl()}/orders/order-1`);
    assert.equal(unauthorizedOrder.status, 401);
    const unauthorizedQueue = await fetch(`${await app.getUrl()}/admin/payments`);
    assert.equal(unauthorizedQueue.status, 401);

    const formData = new FormData();
    formData.append(
      "file",
      new Blob(["%PDF-1.7\nreceipt\n%%EOF\n"], { type: "application/pdf" }),
      "receipt.pdf",
    );
    formData.append("transactionReference", "transfer-9");
    const upload = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer identity-token",
        "x-authenticated-role": "STORE_ADMIN",
      },
      body: formData,
    });
    const uploadBody = await upload.text();
    assert.equal(upload.status, 201, uploadBody);
    const uploadCall = calls[0] as {
      operation: string;
      orderId: string;
      customerId: string;
      role: string;
      file: FormDataEntryValue | null;
    };
    assert.equal(uploadCall.operation, "upload");
    assert.equal(uploadCall.orderId, "order-1");
    assert.equal(uploadCall.customerId, "customer-1");
    assert.equal(uploadCall.role, "CUSTOMER");
    assert.ok(uploadCall.file instanceof File);
    assert.equal(uploadCall.file.name, "receipt.pdf");

    const download = await fetch(url, {
      headers: { authorization: "Bearer identity-token" },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await download.text(), "private-proof");
    assert.deepEqual(calls[1], {
      operation: "download",
      orderId: "order-1",
      customerId: "customer-1",
      role: "CUSTOMER",
    });

    const orderResponse = await fetch(`${await app.getUrl()}/orders/order-1`, {
      headers: { authorization: "Bearer test-token" },
    });
    const orderBody = await orderResponse.text();
    assert.equal(orderResponse.status, 200, orderBody);
    const orderPayload = JSON.parse(orderBody) as { data: { status: string } };
    assert.equal(orderPayload.data.status, "AWAITING_PAYMENT_PROOF");
    assert.deepEqual(calls[2], {
      operation: "order",
      orderId: "order-1",
      customerId: "customer-1",
      role: "CUSTOMER",
    });

    verifiedRole = "STORE_ADMIN";
    const adminOrder = await fetch(`${await app.getUrl()}/orders/order-1`, {
      headers: { authorization: "Bearer test-token" },
    });
    assert.equal(adminOrder.status, 404);
    assert.equal(calls.length, 3);

    verifiedRole = "CUSTOMER";
    const customerQueue = await fetch(`${await app.getUrl()}/admin/payments`, {
      headers: { authorization: "Bearer customer-token" },
    });
    assert.equal(customerQueue.status, 403);
    assert.equal(calls.length, 3);

    verifiedRole = "STORE_ADMIN";
    const queue = await fetch(`${await app.getUrl()}/admin/payments`, {
      headers: {
        authorization: "Bearer verified-admin-token",
        "x-authenticated-role": "CUSTOMER",
      },
    });
    assert.equal(queue.status, 200);
    assert.equal(queue.headers.get("cache-control"), "private, no-store");
    const queueBody = await queue.json() as { data: Array<Record<string, unknown>> };
    assert.equal(queueBody.data[0]?.orderId, "order-1");

    const adminDetail = await fetch(`${await app.getUrl()}/admin/payments/order-1`, {
      headers: { authorization: "Bearer verified-admin-token" },
    });
    assert.equal(adminDetail.status, 200);
    assert.equal(adminDetail.headers.get("cache-control"), "private, no-store");

    const adminEvidence = await fetch(
      `${await app.getUrl()}/admin/payments/order-1/evidence`,
      { headers: { authorization: "Bearer verified-admin-token" } },
    );
    assert.equal(adminEvidence.status, 200);
    assert.equal(adminEvidence.headers.get("cache-control"), "private, no-store");
    assert.equal(adminEvidence.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await adminEvidence.text(), "admin-proof");

    verifiedRole = "CUSTOMER";
    const forbiddenApproval = await fetch(
      `${await app.getUrl()}/admin/payments/order-1/approve`,
      { method: "POST", headers: { authorization: "Bearer test-token" } },
    );
    const forbiddenApprovalBody = await forbiddenApproval.text();
    assert.equal(forbiddenApproval.status, 403, forbiddenApprovalBody);
    verifiedRole = "STORE_ADMIN";
    const approval = await fetch(
      `${await app.getUrl()}/admin/payments/order-1/approve`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "x-authenticated-role": "CUSTOMER",
        },
      },
    );
    assert.equal(approval.status, 201);
    assert.equal(approval.headers.get("cache-control"), "private, no-store");
    const approvalBody = await approval.json() as { data: { status: string } };
    assert.equal(approvalBody.data.status, "PAYMENT_APPROVED_FINALIZING");

    verifiedRole = "CUSTOMER";
    const forbiddenRejection = await fetch(
      `${await app.getUrl()}/admin/payments/order-1/reject`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Receipt mismatch" }),
      },
    );
    const forbiddenRejectionBody = await forbiddenRejection.text();
    assert.equal(forbiddenRejection.status, 403, forbiddenRejectionBody);
    verifiedRole = "STORE_ADMIN";
    const rejection = await fetch(
      `${await app.getUrl()}/admin/payments/order-1/reject`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-access-token",
          "content-type": "application/json",
          "x-authenticated-role": "CUSTOMER",
        },
        body: JSON.stringify({ reason: "Receipt mismatch" }),
      },
    );
    assert.equal(rejection.status, 201);
    assert.equal(rejection.headers.get("cache-control"), "private, no-store");
    const rejectionBody = await rejection.json() as {
      data: { status: string; paymentDecision: { decision: string; reason: string } };
    };
    assert.equal(rejectionBody.data.status, "CANCELLED");
    assert.equal(rejectionBody.data.paymentDecision.decision, "REJECTED");
    assert.equal(rejectionBody.data.paymentDecision.reason, "Receipt mismatch");

    const legalHoldUrl = `${await app.getUrl()}/admin/payment-evidence/order-1/legal-hold`;
    verifiedRole = "CUSTOMER";
    const forbiddenHold = await fetch(legalHoldUrl, {
      method: "POST",
      headers: { authorization: "Bearer customer-token", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Active dispute" }),
    });
    assert.equal(forbiddenHold.status, 403, await forbiddenHold.text());
    verifiedRole = "STORE_ADMIN";
    const hold = await fetch(legalHoldUrl, {
      method: "POST",
      headers: { authorization: "Bearer customer-token", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Active dispute" }),
    });
    assert.equal(hold.status, 201);
    assert.equal(hold.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await hold.json(), {
      data: { orderId: "order-1", legalHold: true, changed: true },
    });
    const releaseHold = await fetch(legalHoldUrl, {
      method: "DELETE",
      headers: { authorization: "Bearer customer-token", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Dispute resolved" }),
    });
    assert.equal(releaseHold.status, 200);
    assert.deepEqual(await releaseHold.json(), {
      data: { orderId: "order-1", legalHold: false, changed: true },
    });

    assert.deepEqual(calls.slice(3), [
      {
        operation: "admin-queue",
        customerId: "customer-1",
        role: "STORE_ADMIN",
      },
      {
        operation: "admin-detail",
        orderId: "order-1",
        customerId: "customer-1",
        role: "STORE_ADMIN",
      },
      {
        operation: "admin-evidence",
        orderId: "order-1",
        customerId: "customer-1",
        role: "STORE_ADMIN",
      },
      {
        operation: "approve",
        orderId: "order-1",
        customerId: "customer-1",
        role: "STORE_ADMIN",
      },
      {
        operation: "reject",
        orderId: "order-1",
        customerId: "customer-1",
        role: "STORE_ADMIN",
        reason: "Receipt mismatch",
      },
      {
        operation: "place-legal-hold",
        orderId: "order-1",
        customerId: "customer-1",
        role: "STORE_ADMIN",
        reason: "Active dispute",
      },
      {
        operation: "release-legal-hold",
        orderId: "order-1",
        customerId: "customer-1",
        role: "STORE_ADMIN",
        reason: "Dispute resolved",
      },
    ]);
  } finally {
    await app.close();
  }
});
