import {
  BadRequestException,
  Body,
  ConflictException,
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
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";

import { CATALOG_PRODUCT_IMAGE_LIMIT } from "@mileshop/contracts";
import type { CatalogProductImageInput } from "@mileshop/contracts";
import {
  CatalogService,
  CatalogConflictError,
  CatalogInputError,
  CatalogNotFoundError,
  ProductDeletionConfirmationRequiredError,
  CATEGORY_THEMES,
  InventoryConflictError,
  ManualSaleIdempotencyConflictError,
  ReservationIdempotencyConflictError,
  StockReceiptIdempotencyConflictError,
} from "./catalog.service.js";
import type {
  AnnouncementInput,
  CategoryInput,
  InventoryReservation,
  ProductInput,
  PromotionInput,
  ReservationRequestLine,
} from "./catalog.service.js";
import { InventoryCommandGuard } from "./inventory-command.guard.js";

type ReservationCommand = {
  orderId: string;
  lines: ReservationRequestLine[];
};

function parseReservationCommand(input: unknown): ReservationCommand {
  if (
    typeof input !== "object" ||
    input === null ||
    !("orderId" in input) ||
    typeof input.orderId !== "string" ||
    !("lines" in input) ||
    !Array.isArray(input.lines)
  ) {
    throw new BadRequestException("Invalid reservation request");
  }

  const lines: ReservationRequestLine[] = [];
  for (const line of input.lines) {
    if (
      typeof line !== "object" ||
      line === null ||
      !("productId" in line) ||
      typeof line.productId !== "string" ||
      !("quantity" in line) ||
      typeof line.quantity !== "number"
    ) {
      throw new BadRequestException("Invalid reservation line");
    }
    lines.push({ productId: line.productId, quantity: line.quantity });
  }

  return { orderId: input.orderId, lines };
}

function parseOrderId(input: unknown): string {
  if (
    typeof input !== "object" ||
    input === null ||
    !("orderId" in input) ||
    typeof input.orderId !== "string" ||
    !input.orderId.trim()
  ) {
    throw new BadRequestException("Order id is required");
  }
  return input.orderId;
}

function parseProductInput(input: unknown): ProductInput {
  if (typeof input !== "object" || input === null) {
    throw new BadRequestException("Invalid product request");
  }
  if (!("imageUrl" in input)) {
    throw new BadRequestException("Invalid product request");
  }
  const imageUrl = parseNullableString(input.imageUrl);
  let images: CatalogProductImageInput[] | undefined;
  if ("images" in input) {
    if (!Array.isArray(input.images) || input.images.length > CATALOG_PRODUCT_IMAGE_LIMIT) {
      throw new BadRequestException("Invalid product image gallery");
    }
    images = input.images.map((image: unknown) => {
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
  if (
    !("sku" in input) ||
    typeof input.sku !== "string" ||
    !("name" in input) ||
    typeof input.name !== "string" ||
    !("description" in input) ||
    typeof input.description !== "string" ||
    !("priceCop" in input) ||
    typeof input.priceCop !== "number" ||
    !("isActive" in input) ||
    typeof input.isActive !== "boolean"
  ) {
    throw new BadRequestException("Invalid product request");
  }
  return {
    sku: input.sku,
    name: input.name,
    description: input.description,
    priceCop: input.priceCop,
    imageUrl,
    ...("imageFileId" in input
      ? { imageFileId: parseNullableString(input.imageFileId) }
      : {}),
    ...("categoryId" in input
      ? { categoryId: parseNullableString(input.categoryId) }
      : {}),
    ...(images !== undefined ? { images } : {}),
    isActive: input.isActive,
  };
}

function parseCategoryInput(input: unknown): CategoryInput {
  if (
    typeof input !== "object" ||
    input === null ||
    !("name" in input) ||
    typeof input.name !== "string" ||
    !("theme" in input) ||
    typeof input.theme !== "string"
  ) {
    throw new BadRequestException("Invalid category request");
  }
  const theme = CATEGORY_THEMES.find((candidate) => candidate === input.theme);
  if (!theme) throw new BadRequestException("Invalid category request");
  return { name: input.name, theme };
}

function parsePromotionInput(input: unknown): PromotionInput {
  if (
    typeof input !== "object" ||
    input === null ||
    !("title" in input) ||
    typeof input.title !== "string" ||
    !("description" in input) ||
    typeof input.description !== "string" ||
    !("startsAt" in input) ||
    typeof input.startsAt !== "string" ||
    !("endsAt" in input) ||
    typeof input.endsAt !== "string" ||
    !("isActive" in input) ||
    typeof input.isActive !== "boolean" ||
    !("products" in input) ||
    !Array.isArray(input.products)
  ) {
    throw new BadRequestException("Invalid promotion request");
  }
  const products = input.products.map((product) => {
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
  });
  return {
    title: input.title,
    description: input.description,
    ...("imageUrl" in input
      ? { imageUrl: parseNullableString(input.imageUrl) }
      : {}),
    ...("imageFileId" in input
      ? { imageFileId: parseNullableString(input.imageFileId) }
      : {}),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive,
    products,
  };
}

function parseAnnouncementInput(input: unknown): AnnouncementInput {
  if (
    typeof input !== "object" ||
    input === null ||
    !("title" in input) ||
    typeof input.title !== "string" ||
    !("message" in input) ||
    typeof input.message !== "string" ||
    !("startsAt" in input) ||
    typeof input.startsAt !== "string" ||
    !("endsAt" in input) ||
    typeof input.endsAt !== "string" ||
    !("isActive" in input) ||
    typeof input.isActive !== "boolean" ||
    !("linkUrl" in input) ||
    (input.linkUrl !== null && typeof input.linkUrl !== "string") ||
    !("linkLabel" in input) ||
    (input.linkLabel !== null && typeof input.linkLabel !== "string")
  ) {
    throw new BadRequestException("Invalid announcement request");
  }
  return {
    title: input.title,
    message: input.message,
    ...("imageUrl" in input
      ? { imageUrl: parseNullableString(input.imageUrl) }
      : {}),
    ...("imageFileId" in input
      ? { imageFileId: parseNullableString(input.imageFileId) }
      : {}),
    linkUrl: input.linkUrl,
    linkLabel: input.linkLabel,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive,
  };
}

function parseNullableString(input: unknown): string | null {
  if (typeof input === "string") {
    return input;
  }
  if (input === null) {
    return null;
  }
  throw new BadRequestException("Invalid product request");
}

function parseInventoryLines(input: unknown): ReservationRequestLine[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) {
    throw new BadRequestException("Request must include between 1 and 50 product lines");
  }
  return input.map((line) => {
    if (
      typeof line !== "object" ||
      line === null ||
      !("productId" in line) ||
      typeof line.productId !== "string" ||
      !("quantity" in line) ||
      typeof line.quantity !== "number" ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new BadRequestException("Invalid inventory line");
    }
    return { productId: line.productId, quantity: line.quantity };
  });
}

function rethrowCatalogError(error: unknown): never {
  if (error instanceof CatalogInputError) throw new BadRequestException(error.message);
  if (
    error instanceof CatalogConflictError ||
    error instanceof InventoryConflictError ||
    error instanceof ReservationIdempotencyConflictError ||
    error instanceof ManualSaleIdempotencyConflictError ||
    error instanceof StockReceiptIdempotencyConflictError
  ) {
    throw new ConflictException(error.message);
  }
  if (error instanceof CatalogNotFoundError) throw new NotFoundException(error.message);
  throw error;
}

@Controller()
export class CatalogController {
  public constructor(
    @Inject("CATALOG_SERVICE") private readonly catalog: CatalogService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  public readiness(): { status: "ready" } {
    return { status: "ready" };
  }

  @Get("products")
  public async products(): Promise<{ data: Awaited<ReturnType<CatalogService["listProducts"]>> }> {
    return { data: await this.catalog.listProducts() };
  }

  @Get("announcements")
  @Header("Cache-Control", "no-store")
  public async announcements(): Promise<{ data: Awaited<ReturnType<CatalogService["listAnnouncements"]>> }> {
    return { data: await this.catalog.listAnnouncements() };
  }

  @Get("promotions")
  @Header("Cache-Control", "no-store")
  public async promotions(): Promise<{ data: Awaited<ReturnType<CatalogService["listPromotions"]>> }> {
    return { data: await this.catalog.listPromotions() };
  }

  @Get("internal/admin/products")
  @UseGuards(InventoryCommandGuard)
  public async adminProducts(): Promise<{ data: Awaited<ReturnType<CatalogService["listAdminProducts"]>> }> {
    return { data: await this.catalog.listAdminProducts() };
  }

  @Get("internal/admin/categories")
  @UseGuards(InventoryCommandGuard)
  public async adminCategories(): Promise<{ data: Awaited<ReturnType<CatalogService["listCategories"]>> }> {
    return { data: await this.catalog.listCategories() };
  }

  @Post("internal/admin/categories")
  @HttpCode(201)
  @UseGuards(InventoryCommandGuard)
  public async createCategory(
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["createCategory"]>> }> {
    try {
      return { data: await this.catalog.createCategory(parseCategoryInput(input)) };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Patch("internal/admin/categories/:categoryId")
  @UseGuards(InventoryCommandGuard)
  public async updateCategory(
    @Param("categoryId") categoryId: string,
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["updateCategory"]>> }> {
    try {
      return { data: await this.catalog.updateCategory(categoryId, parseCategoryInput(input)) };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Delete("internal/admin/categories/:categoryId")
  @UseGuards(InventoryCommandGuard)
  public async deleteCategory(
    @Param("categoryId") categoryId: string,
  ): Promise<{ data: { deleted: true } }> {
    try {
      await this.catalog.deleteCategory(categoryId);
      return { data: { deleted: true } };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Get("internal/admin/promotions")
  @UseGuards(InventoryCommandGuard)
  public async adminPromotions(): Promise<{ data: Awaited<ReturnType<CatalogService["listPromotions"]>> }> {
    return { data: await this.catalog.listPromotions(true) };
  }

  @Post("internal/admin/promotions")
  @HttpCode(201)
  @UseGuards(InventoryCommandGuard)
  public async createPromotion(
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["createPromotion"]>> }> {
    try {
      return { data: await this.catalog.createPromotion(parsePromotionInput(input)) };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Patch("internal/admin/promotions/:promotionId")
  @UseGuards(InventoryCommandGuard)
  public async updatePromotion(
    @Param("promotionId") promotionId: string,
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["updatePromotion"]>> }> {
    try {
      return {
        data: await this.catalog.updatePromotion(promotionId, parsePromotionInput(input)),
      };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Delete("internal/admin/promotions/:promotionId")
  @UseGuards(InventoryCommandGuard)
  public async deletePromotion(
    @Param("promotionId") promotionId: string,
  ): Promise<{ data: { deleted: true } }> {
    try {
      await this.catalog.deletePromotion(promotionId);
      return { data: { deleted: true } };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Get("internal/admin/announcements")
  @UseGuards(InventoryCommandGuard)
  public async adminAnnouncements(): Promise<{ data: Awaited<ReturnType<CatalogService["listAnnouncements"]>> }> {
    return { data: await this.catalog.listAnnouncements(true) };
  }

  @Post("internal/admin/announcements")
  @HttpCode(201)
  @UseGuards(InventoryCommandGuard)
  public async createAnnouncement(
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["createAnnouncement"]>> }> {
    try {
      return { data: await this.catalog.createAnnouncement(parseAnnouncementInput(input)) };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Patch("internal/admin/announcements/:announcementId")
  @UseGuards(InventoryCommandGuard)
  public async updateAnnouncement(
    @Param("announcementId") announcementId: string,
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["updateAnnouncement"]>> }> {
    try {
      return {
        data: await this.catalog.updateAnnouncement(
          announcementId,
          parseAnnouncementInput(input),
        ),
      };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Delete("internal/admin/announcements/:announcementId")
  @UseGuards(InventoryCommandGuard)
  public async deleteAnnouncement(
    @Param("announcementId") announcementId: string,
  ): Promise<{ data: { deleted: true } }> {
    try {
      await this.catalog.deleteAnnouncement(announcementId);
      return { data: { deleted: true } };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Post("internal/admin/products")
  @HttpCode(201)
  @UseGuards(InventoryCommandGuard)
  public async createProduct(
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["createProduct"]>> }> {
    try {
      return { data: await this.catalog.createProduct(parseProductInput(input)) };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Patch("internal/admin/products/:productId")
  @UseGuards(InventoryCommandGuard)
  public async updateProduct(
    @Param("productId") productId: string,
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["updateProduct"]>> }> {
    try {
      return { data: await this.catalog.updateProduct(productId, parseProductInput(input)) };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Delete("internal/admin/products/:productId")
  @UseGuards(InventoryCommandGuard)
  public async deleteProduct(
    @Param("productId") productId: string,
    @Body() input: unknown,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["deleteProduct"]>> }> {
    let confirmRelatedDataDeletion = false;
    if (input !== undefined) {
      if (
        typeof input !== "object" ||
        input === null ||
        !("confirmRelatedDataDeletion" in input) ||
        typeof input.confirmRelatedDataDeletion !== "boolean"
      ) {
        throw new BadRequestException("Invalid product deletion request");
      }
      confirmRelatedDataDeletion = input.confirmRelatedDataDeletion;
    }

    try {
      return {
        data: await this.catalog.deleteProduct(productId, confirmRelatedDataDeletion),
      };
    } catch (error) {
      if (error instanceof ProductDeletionConfirmationRequiredError) {
        throw new ConflictException({
          code: "PRODUCT_HAS_RELATED_DATA",
          message:
            "Este producto tiene información relacionada. Confirma si quieres borrar sus datos de catálogo e inventario; los pedidos y pagos se conservarán como historial.",
          relatedRecords: error.relatedRecords,
        });
      }
      return rethrowCatalogError(error);
    }
  }

  @Post("internal/admin/stock-receipts")
  @HttpCode(201)
  @UseGuards(InventoryCommandGuard)
  public async receiveStock(
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["receiveStock"]>> }> {
    if (!idempotencyKey?.trim() || idempotencyKey.trim().length > 128) {
      throw new BadRequestException("A valid Idempotency-Key header is required");
    }
    if (
      typeof input !== "object" ||
      input === null ||
      !("adminCustomerId" in input) ||
      typeof input.adminCustomerId !== "string" ||
      !("reason" in input) ||
      typeof input.reason !== "string" ||
      !("lines" in input)
    ) {
      throw new BadRequestException("Invalid stock receipt request");
    }
    try {
      return {
        data: await this.catalog.receiveStock(
          input.adminCustomerId,
          idempotencyKey.trim(),
          input.reason,
          parseInventoryLines(input.lines),
        ),
      };
    } catch (error) {
      return rethrowCatalogError(error);
    }
  }

  @Post("internal/reservations")
  @HttpCode(200)
  public async reserveProducts(
    @Body() input: unknown,
    @Headers("x-catalog-reservation-token") token: string | undefined,
  ): Promise<{ data: InventoryReservation }> {
    const expectedToken = process.env.CATALOG_RESERVATION_TOKEN;
    if (!expectedToken) {
      throw new ServiceUnavailableException("Catalog reservation is not configured");
    }
    if (!token || token !== expectedToken) {
      throw new UnauthorizedException("Invalid service credentials");
    }

    const command = parseReservationCommand(input);

    try {
      return { data: await this.catalog.reserveProducts(command.orderId, command.lines) };
    } catch (error) {
      if (
        error instanceof InventoryConflictError ||
        error instanceof ReservationIdempotencyConflictError
      ) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Post("internal/inventory/reservations")
  @HttpCode(200)
  @UseGuards(InventoryCommandGuard)
  public async reserveInventory(
    @Body() input: unknown,
  ): Promise<{ data: InventoryReservation }> {
    const command = parseReservationCommand(input);
    try {
      const reservation = await this.catalog.reserveProducts(command.orderId, command.lines);
      return { data: { ...reservation, status: "ACTIVE" } };
    } catch (error) {
      if (
        error instanceof InventoryConflictError ||
        error instanceof ReservationIdempotencyConflictError
      ) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Post("internal/inventory/reservations/commit")
  @HttpCode(200)
  @UseGuards(InventoryCommandGuard)
  public async commitInventory(
    @Body() input: unknown,
  ): Promise<{ data: InventoryReservation }> {
    return { data: await this.catalog.commitInventory(parseOrderId(input)) };
  }

  @Post("internal/inventory/reservations/release")
  @HttpCode(200)
  @UseGuards(InventoryCommandGuard)
  public async releaseInventory(
    @Body() input: unknown,
  ): Promise<{ data: InventoryReservation }> {
    return { data: await this.catalog.releaseInventory(parseOrderId(input)) };
  }

  @Post("internal/admin/manual-sales")
  @HttpCode(200)
  @UseGuards(InventoryCommandGuard)
  public async recordManualSale(
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["recordManualSale"]>> }> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    if (
      typeof input !== "object" ||
      input === null ||
      !("adminCustomerId" in input) ||
      typeof input.adminCustomerId !== "string" ||
      !("lines" in input) ||
      !Array.isArray(input.lines) ||
      input.lines.length === 0 ||
      input.lines.length > 50
    ) {
      throw new BadRequestException("Invalid manual sale request");
    }
    const lines: ReservationRequestLine[] = input.lines.map((line) => {
      if (
        typeof line !== "object" ||
        line === null ||
        !("productId" in line) ||
        typeof line.productId !== "string" ||
        !("quantity" in line) ||
        typeof line.quantity !== "number" ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0
      ) {
        throw new BadRequestException("Invalid manual sale line");
      }
      return { productId: line.productId, quantity: line.quantity };
    });

    try {
      return {
        data: await this.catalog.recordManualSale(
          input.adminCustomerId,
          idempotencyKey,
          lines,
        ),
      };
    } catch (error) {
      if (
        error instanceof InventoryConflictError ||
        error instanceof ReservationIdempotencyConflictError ||
        error instanceof ManualSaleIdempotencyConflictError
      ) {
        throw new ConflictException(error.message);
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "INVALID_COMMAND"
      ) {
        throw new BadRequestException(
          error instanceof Error ? error.message : "Invalid manual sale request",
        );
      }
      throw error;
    }
  }
}
