import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";
import { IdentityClient } from "./identity.client.js";
import { OrderService, type CreateOrderInput } from "./orders.service.js";
import { StoreAdminGuard } from "./store-admin.guard.js";

@Controller()
export class GatewayController {
  public constructor(
    private readonly catalog: CatalogClient,
    @Inject(OrderService) private readonly orders: any,
    private readonly identity: IdentityClient,
  ) {}

  // ─── Health ──────────────────────────────────────────────────────────────

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  public readiness(): { status: "ready" } {
    return { status: "ready" };
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
    @Body() input: CreateOrderInput,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: { customerId?: string; raw?: { customerId?: string } },
  ): Promise<{ data: Awaited<ReturnType<OrderService["createOrder"]>> }> {
    // AuthMiddleware writes customerId to the raw Node.js request.
    // In Fastify, @Req() gives the Fastify wrapper; the raw request is at req.raw.
    const verifiedCustomerId = req.customerId ?? req.raw?.customerId;
    if (!verifiedCustomerId) {
      throw new NotFoundException("Authenticated customer not found");
    }
    if (!idempotencyKey) {
      throw new BadRequestException("Missing Idempotency-Key header");
    }

    const order = await this.orders.createOrder(input, verifiedCustomerId, idempotencyKey);
    return { data: order };
  }

  @Get("orders/:orderId")
  public async getOrder(
    @Param("orderId") orderId: string,
    @Req() req: { customerId?: string; raw?: { customerId?: string } },
  ): Promise<{ data: Awaited<ReturnType<OrderService["getOrder"]>> }> {
    const verifiedCustomerId = req.customerId ?? req.raw?.customerId;
    if (!verifiedCustomerId) {
      throw new NotFoundException("Order not found");
    }

    const order = await this.orders.getOrder(orderId);
    if (order.customerId !== verifiedCustomerId) {
      throw new NotFoundException("Order not found");
    }

    return { data: order };
  }

  private actor(req: any): { customerId: string; role: string } {
    const raw = req.raw ?? req;
    return {
      customerId: raw.customerId ?? req.customerId ?? "",
      role: raw.role ?? req.role ?? "CUSTOMER",
    };
  }

  @Post("orders/:orderId/cancel")
  @HttpCode(201)
  public cancelOrder(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    try {
      return this.orders.cancelOrder(orderId, actor.customerId, actor.role).then((data: unknown) => ({ data }));
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  @Post("orders/:orderId/cancellation-request")
  @HttpCode(201)
  public requestCancellation(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.requestCancellation(orderId, actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Get("admin/cancellation-requests")
  @UseGuards(StoreAdminGuard)
  public cancellationQueue(@Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.listPendingCancellationRequests(actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Post("admin/cancellation-requests/:orderId/refund-handling")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public refundHandling(
    @Param("orderId") orderId: string,
    @Body() body: any,
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.recordCancellationRefund(
      orderId, actor.customerId, actor.role, body.paymentCaptured, body.externalRefundReference,
    ).then((data: unknown) => ({ data }));
  }

  @Post("admin/cancellation-requests/:orderId/resolve")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public resolveCancellation(
    @Param("orderId") orderId: string,
    @Body() body: any,
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.resolveCancellationRequest(
      orderId, actor.customerId, actor.role, body.action, body.note,
    ).then((data: unknown) => ({ data }));
  }

  @Post("orders/:orderId/payment-evidence")
  @HttpCode(201)
  public uploadEvidence(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    const form = new FormData();
    const fields = req.body ?? req.raw?.body ?? {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") form.append(key, value);
    }
    const uploaded = fields.file;
    if (uploaded?.file) form.append("file", new Blob([uploaded.file]), uploaded.filename ?? "receipt.pdf");
    else if (uploaded) form.append("file", uploaded);
    return (this.orders.uploadPaymentEvidence as any)(orderId, actor.customerId, actor.role, form).then((data: unknown) => ({ data }));
  }

  @Get("orders/:orderId/payment-evidence")
  public async downloadEvidence(@Param("orderId") orderId: string, @Req() req: any): Promise<StreamableFile> {
    const actor = this.actor(req);
    const result = await this.orders.getPaymentEvidence(orderId, actor.customerId, actor.role);
    return new StreamableFile(result.stream, { type: result.contentType, disposition: result.contentDisposition, length: result.contentLength });
  }

  @Get("admin/payments")
  @UseGuards(StoreAdminGuard)
  public adminPayments(@Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.listPendingPaymentReviews(actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Get("admin/payments/:orderId")
  @UseGuards(StoreAdminGuard)
  public adminPayment(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.getPendingPaymentReview(orderId, actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Get("admin/payments/:orderId/evidence")
  @UseGuards(StoreAdminGuard)
  public adminEvidence(@Param("orderId") orderId: string, @Req() req: any): Promise<StreamableFile> {
    return this.orders.getPaymentEvidence(orderId, ...Object.values(this.actor(req)) as [string, string]).then((result: any) =>
      new StreamableFile(result.stream, { type: result.contentType, disposition: result.contentDisposition, length: result.contentLength }),
    );
  }

  @Post("admin/payments/:orderId/evidence")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public deleteEvidence(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.deletePaymentEvidence(orderId, actor.customerId, actor.role, body.confirmDownloaded).then((data: unknown) => ({ data }));
  }

  @Post("admin/payments/:orderId/approve")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public approvePayment(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.approvePaymentEvidence(orderId, actor.customerId, actor.role, body.reason).then((data: unknown) => ({ data }));
  }

  @Post("admin/payments/:orderId/reject")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public rejectPayment(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.rejectPaymentEvidence(orderId, actor.customerId, actor.role, body.reason).then((data: unknown) => ({ data }));
  }

  @Post("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public placeHold(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return this.orders.placePaymentEvidenceLegalHold(orderId, actor.customerId, actor.role, body.reason).then((data: unknown) => ({ data }));
  }

  @Delete("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(StoreAdminGuard)
  @HttpCode(204)
  public releaseHold(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<unknown> {
    const actor = this.actor(req);
    return this.orders.releasePaymentEvidenceLegalHold(orderId, actor.customerId, actor.role, body.reason);
  }
}
