import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { CustomerRole } from "./auth.middleware.js";
import { CatalogClient } from "./catalog.client.js";
import { IdentityClient } from "./identity.client.js";
import { OrderService } from "./orders.service.js";
import { StoreAdminGuard } from "./store-admin.guard.js";

type AuthenticatedRequest = FastifyRequest & {
  customerId?: string;
  role?: CustomerRole;
  raw: FastifyRequest["raw"] & {
    customerId?: string;
    role?: CustomerRole;
  };
};

function getVerifiedIdentity(request: AuthenticatedRequest): {
  customerId: string;
  role: CustomerRole;
} {
  const customerId = request.customerId ?? request.raw.customerId;
  const role = request.role ?? request.raw.role;
  if (!customerId || !role) {
    throw new UnauthorizedException("Authenticated customer is required");
  }
  return { customerId, role };
}

@Controller()
export class GatewayController {
  public constructor(
    @Inject(CatalogClient) private readonly catalog: CatalogClient,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(IdentityClient) private readonly identity: IdentityClient,
  ) {}

  // ─── Health ──────────────────────────────────────────────────────────────

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  // ─── Catalog ─────────────────────────────────────────────────────────────

  @Get("catalog/products")
  public async products(): Promise<{ data: Awaited<ReturnType<CatalogClient["listProducts"]>> }> {
    return { data: await this.catalog.listProducts() };
  }

  // ─── Identity ────────────────────────────────────────────────────────────

  @Post("auth/register")
  public async register(@Body() body: unknown): Promise<unknown> {
    return this.identity.register(body);
  }

  @Post("auth/login")
  @HttpCode(200)
  public async login(@Body() body: unknown): Promise<unknown> {
    return this.identity.login(body);
  }

  @Post("auth/refresh")
  @HttpCode(200)
  public async refresh(@Body() body: unknown): Promise<unknown> {
    return this.identity.refresh(body);
  }

  @Post("auth/logout")
  @HttpCode(204)
  public async logout(@Body() body: unknown): Promise<void> {
    await this.identity.logout(body);
  }

  @Get("auth/me")
  public async getMe(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<unknown> {
    return this.identity.getMe(authorization ?? "");
  }

  // ─── Orders ──────────────────────────────────────────────────────────────

  @Post("orders")
  public async createOrder(
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ data: Awaited<ReturnType<OrderService["createOrder"]>> }> {
    // AuthMiddleware writes customerId to the raw Node.js request.
    // In Fastify, @Req() gives the Fastify wrapper; the raw request is at req.raw.
    const { customerId } = getVerifiedIdentity(req);
    const order = await this.orders.createOrder(input, customerId, idempotencyKey);
    return { data: order };
  }

  @Get("orders/:orderId")
  public async getOrder(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<{ data: Awaited<ReturnType<OrderService["getOrderById"]>> }> {
    const identity = getVerifiedIdentity(req);
    if (identity.role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }
    return {
      data: await this.orders.getOrderById(
        orderId,
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Post("orders/:orderId/cancel")
  @Header("Cache-Control", "private, no-store")
  public async cancelOrder(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<{ data: Awaited<ReturnType<OrderService["cancelOrder"]>> }> {
    const identity = getVerifiedIdentity(req);
    if (identity.role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }
    return {
      data: await this.orders.cancelOrder(
        orderId,
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Post("orders/:orderId/cancellation-request")
  @Header("Cache-Control", "private, no-store")
  public async requestCancellation(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<{ data: Awaited<ReturnType<OrderService["requestCancellation"]>> }> {
    const identity = getVerifiedIdentity(req);
    if (identity.role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }
    return {
      data: await this.orders.requestCancellation(
        orderId,
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Post("orders/:orderId/payment-evidence")
  public async uploadPaymentEvidence(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<{ data: Awaited<ReturnType<OrderService["uploadPaymentEvidence"]>> }> {
    const identity = getVerifiedIdentity(req);
    if (!req.isMultipart()) {
      throw new BadRequestException("A multipart payment evidence file is required");
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeException("Payment evidence exceeds the 10 MiB limit");
      }
      if (typeof code === "string" && code.startsWith("FST_")) {
        throw new BadRequestException("Invalid payment evidence multipart request");
      }
      throw error;
    }

    const data = await this.orders.uploadPaymentEvidence(
      orderId,
      identity.customerId,
      identity.role,
      formData,
    );
    return { data };
  }

  @Get("orders/:orderId/payment-evidence")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async getPaymentEvidence(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<StreamableFile> {
    const identity = getVerifiedIdentity(req);
    const evidence = await this.orders.getPaymentEvidence(
      orderId,
      identity.customerId,
      identity.role,
    );
    return new StreamableFile(evidence.stream, {
      type: evidence.contentType,
      length: evidence.contentLength,
      disposition: evidence.contentDisposition,
    });
  }

  @Get("admin/payments")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async listPendingPayments(
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["listPendingPaymentReviews"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    return {
      data: await this.orders.listPendingPaymentReviews(
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Get("admin/cancellation-requests")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async listPendingCancellationRequests(
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["listPendingCancellationRequests"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    return {
      data: await this.orders.listPendingCancellationRequests(
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Get("admin/payments/:orderId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async getPendingPayment(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["getPendingPaymentReview"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    return {
      data: await this.orders.getPendingPaymentReview(
        orderId,
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Post("admin/payments/:orderId/approve")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async approvePayment(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<{ data: Awaited<ReturnType<OrderService["approvePayment"]>> }> {
    const identity = getVerifiedIdentity(req);
    return {
      data: await this.orders.approvePayment(
        orderId,
        identity.customerId,
        identity.role,
      ),
    };
  }

  @Post("admin/payments/:orderId/reject")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async rejectPayment(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ): Promise<{ data: Awaited<ReturnType<OrderService["rejectPayment"]>> }> {
    const identity = getVerifiedIdentity(req);
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body) && "reason" in body
        ? body.reason
        : undefined;
    return {
      data: await this.orders.rejectPayment(
        orderId,
        identity.customerId,
        identity.role,
        reason,
      ),
    };
  }

  @Post("admin/cancellation-requests/:orderId/refund-handling")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async recordCancellationRefund(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["recordCancellationRefund"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    const paymentCaptured =
      typeof body === "object" && body !== null && !Array.isArray(body) && "paymentCaptured" in body
        ? body.paymentCaptured
        : undefined;
    const externalRefundReference =
      typeof body === "object" &&
        body !== null &&
        !Array.isArray(body) &&
        "externalRefundReference" in body
        ? body.externalRefundReference
        : undefined;
    return {
      data: await this.orders.recordCancellationRefund(
        orderId,
        identity.customerId,
        identity.role,
        paymentCaptured,
        externalRefundReference,
      ),
    };
  }

  @Post("admin/cancellation-requests/:orderId/resolve")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async resolveCancellationRequest(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["resolveCancellationRequest"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    const action =
      typeof body === "object" && body !== null && !Array.isArray(body) && "action" in body
        ? body.action
        : undefined;
    const note =
      typeof body === "object" && body !== null && !Array.isArray(body) && "note" in body
        ? body.note
        : undefined;
    return {
      data: await this.orders.resolveCancellationRequest(
        orderId,
        identity.customerId,
        identity.role,
        action,
        note,
      ),
    };
  }

  @Get("admin/payments/:orderId/evidence")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async getAdminPaymentEvidence(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ): Promise<StreamableFile> {
    const identity = getVerifiedIdentity(req);
    const evidence = await this.orders.getAdminPaymentEvidence(
      orderId,
      identity.customerId,
      identity.role,
    );
    return new StreamableFile(evidence.stream, {
      type: evidence.contentType,
      length: evidence.contentLength,
      disposition: evidence.contentDisposition,
    });
  }

  @Post("admin/payments/:orderId/evidence")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async deleteAdminPaymentEvidence(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["deleteAdminPaymentEvidence"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    const confirmDownloaded =
      typeof body === "object" && body !== null && !Array.isArray(body) &&
      "confirmDownloaded" in body
        ? body.confirmDownloaded
        : undefined;
    return {
      data: await this.orders.deleteAdminPaymentEvidence(
        orderId,
        identity.customerId,
        identity.role,
        confirmDownloaded,
      ),
    };
  }

  @Post("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async placePaymentEvidenceLegalHold(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["placePaymentEvidenceLegalHold"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body) && "reason" in body
        ? body.reason
        : undefined;
    return {
      data: await this.orders.placePaymentEvidenceLegalHold(
        orderId,
        identity.customerId,
        identity.role,
        reason,
      ),
    };
  }

  @Delete("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async releasePaymentEvidenceLegalHold(
    @Req() req: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
  ): Promise<{
    data: Awaited<ReturnType<OrderService["releasePaymentEvidenceLegalHold"]>>;
  }> {
    const identity = getVerifiedIdentity(req);
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body) && "reason" in body
        ? body.reason
        : undefined;
    return {
      data: await this.orders.releasePaymentEvidenceLegalHold(
        orderId,
        identity.customerId,
        identity.role,
        reason,
      ),
    };
  }
}
