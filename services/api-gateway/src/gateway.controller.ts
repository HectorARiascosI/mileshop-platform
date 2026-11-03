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
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { CATALOG_PRODUCT_IMAGE_LIMIT } from "@mileshop/contracts";
import type {
  CatalogAnnouncementInput,
  CatalogProductImageInput,
  CatalogPromotionInput,
} from "@mileshop/contracts";
import { CATALOG_CATEGORY_THEMES } from "@mileshop/contracts";
import type { CatalogCategoryInput } from "@mileshop/contracts";

import {
  CatalogClient,
  type CatalogProductInput,
  type ManualSaleLineInput,
  type StockReceiptLineInput,
} from "./catalog.client.js";
import { IdentityClient } from "./identity.client.js";
import { OrderService, type CreateOrderInput } from "./orders.service.js";
import { StoreAdminGuard } from "./store-admin.guard.js";

@Controller()
export class GatewayController {
  @Inject(OrderService)
  private readonly orders!: OrderService;

  public constructor(
    @Inject(CatalogClient)
    private readonly catalog: CatalogClient,
    @Inject(IdentityClient)
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

  @Get("catalog/announcements")
  public async announcements(): Promise<{ data: unknown }> {
    return { data: await this.catalog.listAnnouncements() };
  }

  @Post("admin/catalog/manual-sales")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async recordManualSale(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    if (!idempotencyKey?.trim() || idempotencyKey.trim().length > 128) {
      throw new BadRequestException("A valid Idempotency-Key header is required");
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("lines" in body)
    ) {
      throw new BadRequestException("Manual sale must include valid product quantities");
    }
    const lines = body.lines;
    if (
      !Array.isArray(lines) ||
      lines.length === 0 ||
      lines.length > 50 ||
      !lines.every(
        (line): line is ManualSaleLineInput =>
          typeof line === "object" &&
          line !== null &&
          typeof line.productId === "string" &&
          line.productId.trim().length > 0 &&
          Number.isSafeInteger(line.quantity) &&
          line.quantity > 0,
      )
    ) {
      throw new BadRequestException("Manual sale must include valid product quantities");
    }
    const actor = this.actor(req);
    return {
      data: await this.catalog.recordManualSale(
        actor.customerId,
        idempotencyKey.trim(),
        lines,
      ),
    };
  }

  @Get("admin/catalog/products")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async adminCatalogProducts(): Promise<{ data: unknown }> {
    return { data: await this.catalog.listAdminProducts() };
  }

  @Post("admin/catalog/products")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createCatalogProduct(
    @Body() body: unknown,
  ): Promise<{ data: unknown }> {
    return { data: await this.catalog.createProduct(this.parseCatalogProduct(body)) };
  }

  @Patch("admin/catalog/products/:productId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async updateCatalogProduct(
    @Param("productId") productId: string,
    @Body() body: unknown,
  ): Promise<{ data: unknown }> {
    if (!productId.trim()) throw new BadRequestException("Product id is required");
    return {
      data: await this.catalog.updateProduct(productId, this.parseCatalogProduct(body)),
    };
  }

  @Get("admin/catalog/categories")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async adminCatalogCategories(): Promise<{ data: unknown }> {
    return { data: await this.catalog.listCategories() };
  }

  @Post("admin/catalog/categories")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createCatalogCategory(
    @Body() body: unknown,
  ): Promise<{ data: unknown }> {
    return { data: await this.catalog.createCategory(this.parseCatalogCategory(body)) };
  }

  @Patch("admin/catalog/categories/:categoryId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async updateCatalogCategory(
    @Param("categoryId") categoryId: string,
    @Body() body: unknown,
  ): Promise<{ data: unknown }> {
    if (!categoryId.trim()) throw new BadRequestException("Category id is required");
    return {
      data: await this.catalog.updateCategory(categoryId, this.parseCatalogCategory(body)),
    };
  }

  @Delete("admin/catalog/categories/:categoryId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async deleteCatalogCategory(
    @Param("categoryId") categoryId: string,
  ): Promise<{ data: { deleted: true } }> {
    if (!categoryId.trim()) throw new BadRequestException("Category id is required");
    return { data: await this.catalog.deleteCategory(categoryId) };
  }

  @Get("admin/catalog/promotions")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async adminCatalogPromotions(): Promise<{ data: unknown }> {
    return { data: await this.catalog.listPromotions() };
  }

  @Post("admin/catalog/promotions")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createCatalogPromotion(@Body() body: unknown): Promise<{ data: unknown }> {
    return { data: await this.catalog.createPromotion(this.parseCatalogPromotion(body)) };
  }

  @Patch("admin/catalog/promotions/:promotionId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async updateCatalogPromotion(
    @Param("promotionId") promotionId: string,
    @Body() body: unknown,
  ): Promise<{ data: unknown }> {
    if (!promotionId.trim()) throw new BadRequestException("Promotion id is required");
    return {
      data: await this.catalog.updatePromotion(
        promotionId,
        this.parseCatalogPromotion(body),
      ),
    };
  }

  @Delete("admin/catalog/promotions/:promotionId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async deleteCatalogPromotion(
    @Param("promotionId") promotionId: string,
  ): Promise<{ data: { deleted: true } }> {
    if (!promotionId.trim()) throw new BadRequestException("Promotion id is required");
    return { data: await this.catalog.deletePromotion(promotionId) };
  }

  @Get("admin/catalog/announcements")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async adminCatalogAnnouncements(): Promise<{ data: unknown }> {
    return { data: await this.catalog.listAdminAnnouncements() };
  }

  @Post("admin/catalog/announcements")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async createCatalogAnnouncement(@Body() body: unknown): Promise<{ data: unknown }> {
    return {
      data: await this.catalog.createAnnouncement(this.parseCatalogAnnouncement(body)),
    };
  }

  @Patch("admin/catalog/announcements/:announcementId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async updateCatalogAnnouncement(
    @Param("announcementId") announcementId: string,
    @Body() body: unknown,
  ): Promise<{ data: unknown }> {
    if (!announcementId.trim()) throw new BadRequestException("Announcement id is required");
    return {
      data: await this.catalog.updateAnnouncement(
        announcementId,
        this.parseCatalogAnnouncement(body),
      ),
    };
  }

  @Delete("admin/catalog/announcements/:announcementId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async deleteCatalogAnnouncement(
    @Param("announcementId") announcementId: string,
  ): Promise<{ data: { deleted: true } }> {
    if (!announcementId.trim()) throw new BadRequestException("Announcement id is required");
    return { data: await this.catalog.deleteAnnouncement(announcementId) };
  }

  @Post("admin/catalog/stock-receipts")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async receiveCatalogStock(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    if (!idempotencyKey?.trim() || idempotencyKey.trim().length > 128) {
      throw new BadRequestException("A valid Idempotency-Key header is required");
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("reason" in body) ||
      typeof body.reason !== "string" ||
      !("lines" in body) ||
      !Array.isArray(body.lines) ||
      body.lines.length === 0 ||
      body.lines.length > 50 ||
      !body.lines.every(
        (line): line is StockReceiptLineInput =>
          typeof line === "object" &&
          line !== null &&
          typeof line.productId === "string" &&
          line.productId.trim().length > 0 &&
          Number.isSafeInteger(line.quantity) &&
          line.quantity > 0,
      )
    ) {
      throw new BadRequestException("Stock receipt must include a reason and valid quantities");
    }
    const actor = this.actor(req);
    return {
      data: await this.catalog.receiveStock(
        actor.customerId,
        idempotencyKey.trim(),
        body.reason,
        body.lines,
      ),
    };
  }

  private parseCatalogProduct(body: unknown): CatalogProductInput {
    if (
      typeof body !== "object" ||
      body === null ||
      !("sku" in body) ||
      typeof body.sku !== "string" ||
      !("name" in body) ||
      typeof body.name !== "string" ||
      !("description" in body) ||
      typeof body.description !== "string" ||
      !("priceCop" in body) ||
      typeof body.priceCop !== "number" ||
      !("imageUrl" in body) ||
      (body.imageUrl !== null && typeof body.imageUrl !== "string") ||
      ("imageFileId" in body &&
        body.imageFileId !== null &&
        typeof body.imageFileId !== "string") ||
      ("categoryId" in body &&
        body.categoryId !== null &&
        (typeof body.categoryId !== "string" || !body.categoryId.trim())) ||
      !("isActive" in body) ||
      typeof body.isActive !== "boolean"
    ) {
      throw new BadRequestException("Invalid product request");
    }
    let images: CatalogProductImageInput[] | undefined;
    if ("images" in body) {
      if (!Array.isArray(body.images) || body.images.length > CATALOG_PRODUCT_IMAGE_LIMIT) {
        throw new BadRequestException("Invalid product image gallery");
      }
      images = body.images.map((image: unknown) => {
        if (
          typeof image !== "object" ||
          image === null ||
          !("imageUrl" in image) ||
          typeof image.imageUrl !== "string" ||
          ("imageFileId" in image &&
            image.imageFileId !== null &&
            typeof image.imageFileId !== "string")
        ) {
          throw new BadRequestException("Invalid product image");
        }
        return {
          imageUrl: image.imageUrl,
          ...("imageFileId" in image
            ? {
                imageFileId:
                  typeof image.imageFileId === "string" ? image.imageFileId : null,
              }
            : {}),
        };
      });
    }
    return {
      sku: body.sku,
      name: body.name,
      description: body.description,
      priceCop: body.priceCop,
      imageUrl: body.imageUrl,
      ...("imageFileId" in body
        ? {
            imageFileId:
              typeof body.imageFileId === "string" ? body.imageFileId : null,
          }
        : {}),
      ...("categoryId" in body
        ? {
            categoryId:
              typeof body.categoryId === "string" ? body.categoryId : null,
          }
        : {}),
      ...(images !== undefined ? { images } : {}),
      isActive: body.isActive,
    };
  }

  private parseCatalogCategory(body: unknown): CatalogCategoryInput {
    if (
      typeof body !== "object" ||
      body === null ||
      !("name" in body) ||
      typeof body.name !== "string" ||
      !("theme" in body) ||
      typeof body.theme !== "string"
    ) {
      throw new BadRequestException("Invalid category request");
    }
    const theme = CATALOG_CATEGORY_THEMES.find((candidate) => candidate === body.theme);
    if (!theme) throw new BadRequestException("Invalid category request");
    return { name: body.name, theme };
  }

  private parseCatalogPromotion(body: unknown): CatalogPromotionInput {
    if (
      typeof body !== "object" ||
      body === null ||
      !("title" in body) ||
      typeof body.title !== "string" ||
      !("description" in body) ||
      typeof body.description !== "string" ||
      !("startsAt" in body) ||
      typeof body.startsAt !== "string" ||
      !("endsAt" in body) ||
      typeof body.endsAt !== "string" ||
      !("isActive" in body) ||
      typeof body.isActive !== "boolean" ||
      !("products" in body) ||
      !Array.isArray(body.products)
    ) {
      throw new BadRequestException("Invalid promotion request");
    }
    return {
      title: body.title,
      description: body.description,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      isActive: body.isActive,
      products: body.products.map((product) => {
        if (
          typeof product !== "object" ||
          product === null ||
          !("productId" in product) ||
          typeof product.productId !== "string" ||
          !("discountPercent" in product) ||
          typeof product.discountPercent !== "number"
        ) {
          throw new BadRequestException("Invalid promotion product");
        }
        return { productId: product.productId, discountPercent: product.discountPercent };
      }),
    };
  }

  private parseCatalogAnnouncement(body: unknown): CatalogAnnouncementInput {
    if (
      typeof body !== "object" ||
      body === null ||
      !("title" in body) ||
      typeof body.title !== "string" ||
      !("message" in body) ||
      typeof body.message !== "string" ||
      !("linkUrl" in body) ||
      (body.linkUrl !== null && typeof body.linkUrl !== "string") ||
      !("linkLabel" in body) ||
      (body.linkLabel !== null && typeof body.linkLabel !== "string") ||
      !("startsAt" in body) ||
      typeof body.startsAt !== "string" ||
      !("endsAt" in body) ||
      typeof body.endsAt !== "string" ||
      !("isActive" in body) ||
      typeof body.isActive !== "boolean"
    ) {
      throw new BadRequestException("Invalid announcement request");
    }
    return {
      title: body.title,
      message: body.message,
      linkUrl: body.linkUrl,
      linkLabel: body.linkLabel,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      isActive: body.isActive,
    };
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
    @Req() req: { customerId?: string; role?: string; raw?: { customerId?: string; role?: string } },
  ): Promise<{ data: Awaited<ReturnType<OrderService["getOrder"]>> }> {
    const verifiedCustomerId = req.customerId ?? req.raw?.customerId;
    if (!verifiedCustomerId) {
      throw new NotFoundException("Order not found");
    }
    if ((req.raw?.role ?? req.role) === "STORE_ADMIN") {
      throw new NotFoundException("Order not found");
    }

    const order = await this.orders.getOrder(orderId, verifiedCustomerId, req.raw?.role ?? "CUSTOMER");
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

  @Get("admin/orders")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public async adminOrders(@Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return { data: await this.orders.listAdminOrders(actor.customerId) };
  }

  @Post("admin/orders/:orderId/confirm")
  @UseGuards(StoreAdminGuard)
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async confirmAdminOrder(
    @Param("orderId") orderId: string,
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return { data: await this.orders.confirmAdminOrder(actor.customerId, orderId) };
  }

  @Post("admin/orders/:orderId/payment-reported")
  @UseGuards(StoreAdminGuard)
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async markAdminOrderPaymentReported(
    @Param("orderId") orderId: string,
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return { data: await this.orders.markPaymentReported(actor.customerId, orderId) };
  }

  @Post("admin/orders/:orderId/cancel")
  @UseGuards(StoreAdminGuard)
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  public async cancelAdminOrder(
    @Param("orderId") orderId: string,
    @Body() body: { reason?: unknown },
    @Req() req: any,
  ): Promise<{ data: unknown }> {
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new BadRequestException("Cancellation reason is required");
    }
    const actor = this.actor(req);
    return { data: await this.orders.cancelAdminOrder(actor.customerId, orderId, body.reason) };
  }

  @Post("orders/:orderId/cancel")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public async cancelOrder(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    if (actor.role !== "CUSTOMER") {
      throw new NotFoundException("Order not found");
    }
    try {
      const data = await (this.orders as any).cancelOrder(orderId, actor.customerId, actor.role);
      return { data };
    } catch (error) {
      console.error("cancelOrder failed", error);
      throw error;
    }
  }

  @Post("orders/:orderId/cancellation-request")
  @HttpCode(201)
  public requestCancellation(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).requestCancellation(orderId, actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Get("admin/cancellation-requests")
  @UseGuards(StoreAdminGuard)
  public cancellationQueue(@Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).listPendingCancellationRequests(actor.customerId, actor.role).then((data: unknown) => ({ data }));
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
    return (this.orders as any).recordCancellationRefund(
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
    return (this.orders as any).resolveCancellationRequest(
      orderId, actor.customerId, actor.role, body.action, body.note,
    ).then((data: unknown) => ({ data }));
  }

  @Post("orders/:orderId/payment-evidence")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
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
    return ((this.orders as any).uploadPaymentEvidence as any)(orderId, actor.customerId, actor.role, form).then((data: unknown) => ({ data }));
  }

  @Get("orders/:orderId/payment-evidence")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async downloadEvidence(@Param("orderId") orderId: string, @Req() req: any): Promise<StreamableFile> {
    const actor = this.actor(req);
    const result = await (this.orders as any).getPaymentEvidence(orderId, actor.customerId, actor.role);
    return new StreamableFile(result.stream, { type: result.contentType, disposition: result.contentDisposition, length: result.contentLength });
  }

  @Get("admin/payments")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public adminPayments(@Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).listPendingPaymentReviews(actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Get("admin/payments/:orderId")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public adminPayment(@Param("orderId") orderId: string, @Req() req: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).getPendingPaymentReview(orderId, actor.customerId, actor.role).then((data: unknown) => ({ data }));
  }

  @Get("admin/payments/:orderId/evidence")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public adminEvidence(@Param("orderId") orderId: string, @Req() req: any): Promise<StreamableFile> {
    const actor = this.actor(req);
    return (this.orders as any).getAdminPaymentEvidence(orderId, actor.customerId, actor.role).then((result: any) =>
      new StreamableFile(result.stream, { type: result.contentType, disposition: result.contentDisposition, length: result.contentLength }),
    );
  }

  @Post("admin/payments/:orderId/evidence")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  public async deleteEvidence(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    try {
      const data = await (this.orders as any).deleteAdminPaymentEvidence(orderId, actor.customerId, actor.role, body.confirmDownloaded);
      return { data };
    } catch (error) {
      console.error("deleteEvidence failed", error);
      throw error;
    }
  }

  @Post("admin/payments/:orderId/approve")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public approvePayment(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).approvePayment(orderId, actor.customerId, actor.role, body?.reason).then((data: unknown) => ({ data }));
  }

  @Post("admin/payments/:orderId/reject")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public rejectPayment(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).rejectPayment(orderId, actor.customerId, actor.role, body?.reason).then((data: unknown) => ({ data }));
  }

  @Post("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(StoreAdminGuard)
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  public placeHold(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).placePaymentEvidenceLegalHold(orderId, actor.customerId, actor.role, body.reason).then((data: unknown) => ({ data }));
  }

  @Delete("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(StoreAdminGuard)
  @Header("Cache-Control", "private, no-store")
  public releaseHold(@Param("orderId") orderId: string, @Req() req: any, @Body() body: any): Promise<{ data: unknown }> {
    const actor = this.actor(req);
    return (this.orders as any).releasePaymentEvidenceLegalHold(orderId, actor.customerId, actor.role, body.reason).then((data: unknown) => ({ data }));
  }
}
