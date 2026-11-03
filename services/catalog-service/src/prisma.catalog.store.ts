import { PrismaClient } from "../generated/catalog-client/index.js";

import {
  CatalogConflictError,
  CatalogNotFoundError,
  InventoryConflictError,
  ManualSaleIdempotencyConflictError,
  ReservationIdempotencyConflictError,
  StockReceiptIdempotencyConflictError,
  normalizeCategoryInput,
  normalizeAnnouncementInput,
  normalizePromotionInput,
  normalizeProductInput,
  normalizeReservationLines,
  normalizeStockReceipt,
} from "./catalog.service.js";
import type {
  CatalogStore,
  Category,
  CategoryInput,
  Announcement,
  AnnouncementInput,
  InventoryReservation,
  ManualSale,
  ProductInput,
  Product,
  Promotion,
  PromotionInput,
  ReservationRequestLine,
  StockReceipt,
} from "./catalog.service.js";

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isPrismaForeignKeyConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}

function isPrismaTransactionConflictError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

export class PrismaCatalogStore implements CatalogStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listActiveProducts(): Promise<Product[]> {
    const now = new Date();
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        priceCop: true,
        stock: true,
        imageUrl: true,
        images: {
          orderBy: { position: "asc" },
          select: { imageUrl: true, position: true },
        },
        category: {
          select: { id: true, name: true, slug: true, theme: true },
        },
        promotions: {
          where: {
            promotion: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
          },
          orderBy: { discountPercent: "desc" },
          take: 1,
          select: {
            discountPercent: true,
            promotion: {
              select: { id: true, title: true, startsAt: true, endsAt: true },
            },
          },
        },
      },
    });
    return products.map(({ imageUrl, images, category, promotions, ...product }) => {
      const activePromotion = promotions[0];
      const promotion = activePromotion
        ? {
            id: activePromotion.promotion.id,
            title: activePromotion.promotion.title,
            discountPercent: activePromotion.discountPercent,
            startsAt: activePromotion.promotion.startsAt.toISOString(),
            endsAt: activePromotion.promotion.endsAt.toISOString(),
          }
        : null;
      return {
        ...product,
        ...(promotion
          ? {
              priceBeforeDiscountCop: product.priceCop,
              priceCop: Math.round(
                (product.priceCop * (100 - promotion.discountPercent)) / 100,
              ),
              promotion,
            }
          : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(images.length ? { images } : {}),
        ...(category ? { category } : {}),
      };
    });
  }

  public async listAdminProducts(): Promise<Product[]> {
    return this.prisma.product.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        priceCop: true,
        stock: true,
        imageUrl: true,
        imageFileId: true,
        images: {
          orderBy: { position: "asc" },
          select: { imageUrl: true, imageFileId: true, position: true },
        },
        isActive: true,
        categoryId: true,
        category: {
          select: { id: true, name: true, slug: true, theme: true },
        },
      },
    });
  }

  public async listCategories(): Promise<Category[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return categories.map(({ _count, ...category }) => ({ ...category, productCount: _count.products }));
  }

  public async createCategory(input: CategoryInput): Promise<Category> {
    const normalized = normalizeCategoryInput(input);
    try {
      return {
        ...(await this.prisma.category.create({
          data: normalized,
        })),
        productCount: 0,
      };
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new CatalogConflictError("A category with this name already exists");
      }
      throw error;
    }
  }

  public async updateCategory(categoryId: string, input: CategoryInput): Promise<Category> {
    const normalized = normalizeCategoryInput(input);
    try {
      const category = await this.prisma.category.update({
        where: { id: categoryId },
        data: normalized,
        include: { _count: { select: { products: true } } },
      });
      const { _count, ...updatedCategory } = category;
      return { ...updatedCategory, productCount: _count.products };
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new CatalogConflictError("A category with this name already exists");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Category not found");
      }
      throw error;
    }
  }

  public async deleteCategory(categoryId: string): Promise<void> {
    try {
      await this.prisma.category.delete({ where: { id: categoryId } });
    } catch (error) {
      if (isPrismaForeignKeyConstraintError(error)) {
        throw new CatalogConflictError("Reassign products before deleting this category");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Category not found");
      }
      throw error;
    }
  }

  public async listPromotions(includeInactive = false): Promise<Promotion[]> {
    const now = new Date();
    const records = await this.prisma.promotion.findMany({
      where: includeInactive
        ? {}
        : { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      include: {
        products: {
          orderBy: { productId: "asc" },
          include: { product: { select: { name: true, sku: true } } },
        },
      },
    });
    return records.map((promotion) => ({
      id: promotion.id,
      title: promotion.title,
      description: promotion.description,
      startsAt: promotion.startsAt.toISOString(),
      endsAt: promotion.endsAt.toISOString(),
      isActive: promotion.isActive,
      products: promotion.products.map(({ productId, discountPercent, product }) => ({
        productId,
        discountPercent,
        name: product.name,
        sku: product.sku,
      })),
      createdAt: promotion.createdAt.toISOString(),
      updatedAt: promotion.updatedAt.toISOString(),
    }));
  }

  public async createPromotion(input: PromotionInput): Promise<Promotion> {
    const normalized = normalizePromotionInput(input);
    try {
      const promotion = await this.prisma.$transaction(async (transaction) => {
        await this.assertNoOverlappingPromotion(transaction, normalized);
        return transaction.promotion.create({
          data: {
            title: normalized.title,
            description: normalized.description,
            startsAt: new Date(normalized.startsAt),
            endsAt: new Date(normalized.endsAt),
            isActive: normalized.isActive,
            products: {
              create: normalized.products.map((product) => ({
                productId: product.productId,
                discountPercent: product.discountPercent,
              })),
            },
          },
          include: {
            products: {
              orderBy: { productId: "asc" },
              include: { product: { select: { name: true, sku: true } } },
            },
          },
        });
      }, { isolationLevel: "Serializable" });
      return this.mapPromotion(promotion);
    } catch (error) {
      if (isPrismaTransactionConflictError(error)) {
        throw new CatalogConflictError("Promotion products conflict with another campaign change");
      }
      if (isPrismaForeignKeyConstraintError(error)) {
        throw new CatalogNotFoundError("One or more promotion products were not found");
      }
      if (isPrismaUniqueConstraintError(error)) {
        throw new CatalogConflictError("Promotion products conflict with existing data");
      }
      throw error;
    }
  }

  public async updatePromotion(promotionId: string, input: PromotionInput): Promise<Promotion> {
    const normalized = normalizePromotionInput(input);
    try {
      const promotion = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.promotion.findUnique({
          where: { id: promotionId },
          select: { id: true },
        });
        if (!existing) throw new CatalogNotFoundError("Promotion not found");
        await this.assertNoOverlappingPromotion(transaction, normalized, promotionId);
        return transaction.promotion.update({
          where: { id: promotionId },
          data: {
            title: normalized.title,
            description: normalized.description,
            startsAt: new Date(normalized.startsAt),
            endsAt: new Date(normalized.endsAt),
            isActive: normalized.isActive,
            products: {
              deleteMany: {},
              create: normalized.products.map((product) => ({
                productId: product.productId,
                discountPercent: product.discountPercent,
              })),
            },
          },
          include: {
            products: {
              orderBy: { productId: "asc" },
              include: { product: { select: { name: true, sku: true } } },
            },
          },
        });
      }, { isolationLevel: "Serializable" });
      return this.mapPromotion(promotion);
    } catch (error) {
      if (isPrismaTransactionConflictError(error)) {
        throw new CatalogConflictError("Promotion products conflict with another campaign change");
      }
      if (isPrismaForeignKeyConstraintError(error)) {
        throw new CatalogNotFoundError("One or more promotion products were not found");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Promotion not found");
      }
      throw error;
    }
  }

  public async deletePromotion(promotionId: string): Promise<void> {
    try {
      await this.prisma.promotion.delete({ where: { id: promotionId } });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Promotion not found");
      }
      throw error;
    }
  }

  public async listAnnouncements(includeInactive = false): Promise<Announcement[]> {
    const now = new Date();
    const records = await this.prisma.announcement.findMany({
      where: includeInactive
        ? {}
        : { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
    });
    return records.map((announcement) => ({
      ...announcement,
      linkUrl: announcement.linkUrl,
      linkLabel: announcement.linkLabel,
      startsAt: announcement.startsAt.toISOString(),
      endsAt: announcement.endsAt.toISOString(),
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
    }));
  }

  public async createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
    const normalized = normalizeAnnouncementInput(input);
    const record = await this.prisma.announcement.create({
      data: {
        ...normalized,
        startsAt: new Date(normalized.startsAt),
        endsAt: new Date(normalized.endsAt),
      },
    });
    return {
      ...record,
      linkUrl: record.linkUrl,
      linkLabel: record.linkLabel,
      startsAt: record.startsAt.toISOString(),
      endsAt: record.endsAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  public async updateAnnouncement(
    announcementId: string,
    input: AnnouncementInput,
  ): Promise<Announcement> {
    const normalized = normalizeAnnouncementInput(input);
    try {
      const record = await this.prisma.announcement.update({
        where: { id: announcementId },
        data: {
          ...normalized,
          startsAt: new Date(normalized.startsAt),
          endsAt: new Date(normalized.endsAt),
        },
      });
      return {
        ...record,
        linkUrl: record.linkUrl,
        linkLabel: record.linkLabel,
        startsAt: record.startsAt.toISOString(),
        endsAt: record.endsAt.toISOString(),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Announcement not found");
      }
      throw error;
    }
  }

  public async deleteAnnouncement(announcementId: string): Promise<void> {
    try {
      await this.prisma.announcement.delete({ where: { id: announcementId } });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Announcement not found");
      }
      throw error;
    }
  }

  private mapPromotion(promotion: {
    id: string;
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    products: Array<{
      productId: string;
      discountPercent: number;
      product: { name: string; sku: string };
    }>;
  }): Promotion {
    return {
      id: promotion.id,
      title: promotion.title,
      description: promotion.description,
      startsAt: promotion.startsAt.toISOString(),
      endsAt: promotion.endsAt.toISOString(),
      isActive: promotion.isActive,
      products: promotion.products.map(({ productId, discountPercent, product }) => ({
        productId,
        discountPercent,
        name: product.name,
        sku: product.sku,
      })),
      createdAt: promotion.createdAt.toISOString(),
      updatedAt: promotion.updatedAt.toISOString(),
    };
  }

  private async assertNoOverlappingPromotion(
    transaction: Pick<PrismaClient, "promotionProduct">,
    input: PromotionInput,
    excludedPromotionId?: string,
  ): Promise<void> {
    if (!input.isActive) return;
    const conflict = await transaction.promotionProduct.findFirst({
      where: {
        productId: { in: input.products.map((product) => product.productId) },
        promotion: {
          isActive: true,
          startsAt: { lt: new Date(input.endsAt) },
          endsAt: { gt: new Date(input.startsAt) },
          ...(excludedPromotionId ? { id: { not: excludedPromotionId } } : {}),
        },
      },
      select: { productId: true },
    });
    if (conflict) {
      throw new CatalogConflictError("An active promotion already overlaps for one or more products");
    }
  }

  public async createProduct(input: ProductInput): Promise<Product> {
    const normalized = normalizeProductInput(input);
    const { images: requestedImages, ...productFields } = normalized;
    const images = requestedImages.map((image, position) => ({
      imageUrl: image.imageUrl,
      imageFileId: image.imageFileId ?? null,
      position,
    }));
    try {
      return await this.prisma.product.create({
        data: {
          ...productFields,
          imageUrl: images[0]?.imageUrl ?? null,
          imageFileId: images[0]?.imageFileId ?? null,
          stock: 0,
          ...(images.length
            ? {
                images: {
                  create: images,
                },
              }
            : {}),
        },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          priceCop: true,
          stock: true,
          imageUrl: true,
          imageFileId: true,
          images: {
            orderBy: { position: "asc" },
            select: { imageUrl: true, imageFileId: true, position: true },
          },
          isActive: true,
          categoryId: true,
          category: {
            select: { id: true, name: true, slug: true, theme: true },
          },
        },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new CatalogConflictError("A product with this SKU already exists");
      }
      throw error;
    }
  }

  public async updateProduct(productId: string, input: ProductInput): Promise<Product> {
    const normalized = normalizeProductInput(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.product.findUnique({
          where: { id: productId },
          select: {
            images: {
              select: { imageUrl: true, imageFileId: true },
            },
          },
        });
        if (!existing) throw new CatalogNotFoundError("Product not found");

        const { images: requestedImages, ...productFields } = normalized;
        const images = requestedImages.map((image, position) => {
          const previousImage = existing.images.find(
            (candidate) => candidate.imageUrl === image.imageUrl,
          );
          return {
            imageUrl: image.imageUrl,
            imageFileId:
              image.imageFileId === undefined
                ? previousImage?.imageFileId ?? null
                : image.imageFileId,
            position,
          };
        });
        return transaction.product.update({
          where: { id: productId },
          data: {
            ...productFields,
            imageUrl: images[0]?.imageUrl ?? null,
            imageFileId: images[0]?.imageFileId ?? null,
            images: {
              deleteMany: {},
              ...(images.length ? { create: images } : {}),
            },
          },
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            priceCop: true,
            stock: true,
            imageUrl: true,
            imageFileId: true,
            images: {
              orderBy: { position: "asc" },
              select: { imageUrl: true, imageFileId: true, position: true },
            },
            isActive: true,
            categoryId: true,
            category: {
              select: { id: true, name: true, slug: true, theme: true },
            },
          },
        });
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new CatalogConflictError("A product with this SKU already exists");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new CatalogNotFoundError("Product not found");
      }
      throw error;
    }
  }

  public async recordStockReceipt(
    adminCustomerId: string,
    idempotencyKey: string,
    reason: string,
    lines: ReservationRequestLine[],
  ): Promise<StockReceipt> {
    const request = normalizeStockReceipt(adminCustomerId, idempotencyKey, reason, lines);
    const requestLines = request.lines;
    const requestFingerprint = JSON.stringify({
      adminCustomerId: request.adminCustomerId,
      reason: request.reason,
      lines: requestLines,
    });
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.stockReceipt.findUnique({
          where: { idempotencyKey: request.idempotencyKey },
          include: { lines: { orderBy: { productId: "asc" } } },
        });
        if (existing) return this.returnExistingStockReceipt(existing, requestFingerprint);

        const receiptLines = [];
        for (const line of requestLines) {
          const product = await transaction.product.findUnique({
            where: { id: line.productId },
            select: { id: true, sku: true, name: true, stock: true },
          });
          if (!product) throw new CatalogNotFoundError(`Product not found: ${line.productId}`);
          if (product.stock + line.quantity > 2_000_000_000) {
            throw new CatalogConflictError(`Stock limit exceeded for ${product.sku}`);
          }
          const updated = await transaction.product.updateMany({
            where: { id: product.id, stock: { lte: 2_000_000_000 - line.quantity } },
            data: { stock: { increment: line.quantity } },
          });
          if (updated.count !== 1) {
            throw new CatalogConflictError(`Stock limit exceeded for ${product.sku}`);
          }
          receiptLines.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            quantity: line.quantity,
          });
        }

        const receipt = await transaction.stockReceipt.create({
          data: {
            idempotencyKey: request.idempotencyKey,
            adminCustomerId: request.adminCustomerId,
            reason: request.reason,
            requestFingerprint,
            lines: { create: receiptLines },
          },
          include: { lines: { orderBy: { productId: "asc" } } },
        });
        return this.mapStockReceipt(receipt);
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.stockReceipt.findUnique({
        where: { idempotencyKey: request.idempotencyKey },
        include: { lines: { orderBy: { productId: "asc" } } },
      });
      if (existing) return this.returnExistingStockReceipt(existing, requestFingerprint);
      throw error;
    }
  }

  public async recordManualSale(
    adminCustomerId: string,
    idempotencyKey: string,
    lines: ReservationRequestLine[],
  ): Promise<ManualSale> {
    const requestLines = normalizeReservationLines(lines);
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.manualSale.findUnique({
          where: { idempotencyKey },
          include: { lines: { orderBy: { productId: "asc" } } },
        });
        if (existing) return this.returnExistingManualSale(existing, requestLines);

        const saleLines = [];
        for (const line of requestLines) {
          const product = await transaction.product.findFirst({
            where: { id: line.productId, isActive: true },
            select: {
              id: true,
              sku: true,
              name: true,
              priceCop: true,
              promotions: {
                where: {
                  promotion: {
                    isActive: true,
                    startsAt: { lte: now },
                    endsAt: { gt: now },
                  },
                },
                orderBy: { discountPercent: "desc" },
                take: 1,
                select: { discountPercent: true },
              },
            },
          });
          if (!product) {
            throw new InventoryConflictError(`Product is not available: ${line.productId}`);
          }
          const updated = await transaction.product.updateMany({
            where: {
              id: product.id,
              isActive: true,
              sku: product.sku,
              name: product.name,
              priceCop: product.priceCop,
              stock: { gte: line.quantity },
            },
            data: { stock: { decrement: line.quantity } },
          });
          if (updated.count !== 1) {
            throw new InventoryConflictError(`Insufficient stock: ${product.sku}`);
          }
          saleLines.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            quantity: line.quantity,
            unitPriceCop: Math.round(
              (product.priceCop * (100 - (product.promotions[0]?.discountPercent ?? 0))) / 100,
            ),
          });
        }

        const created = await transaction.manualSale.create({
          data: {
            idempotencyKey,
            adminCustomerId,
            requestLines: requestLines as never,
            lines: { create: saleLines },
          },
          include: { lines: { orderBy: { productId: "asc" } } },
        });
        return this.mapManualSale(created);
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.manualSale.findUnique({
        where: { idempotencyKey },
        include: { lines: { orderBy: { productId: "asc" } } },
      });
      if (existing) return this.returnExistingManualSale(existing, requestLines);
      throw error;
    }
  }

  public async reserveProducts(
    orderId: string,
    lines: ReservationRequestLine[],
  ): Promise<InventoryReservation> {
    const requestLines = normalizeReservationLines(lines);
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.inventoryReservation.findUnique({
          where: { orderId },
          include: { items: { orderBy: { productId: "asc" } } },
        });
        if (existing) {
          return this.returnExistingReservation(existing, requestLines);
        }

        const reservedProducts = [];
        for (const line of requestLines) {
          const product = await transaction.product.findFirst({
            where: { id: line.productId, isActive: true },
            select: {
              id: true,
              sku: true,
              name: true,
              priceCop: true,
              promotions: {
                where: {
                  promotion: {
                    isActive: true,
                    startsAt: { lte: now },
                    endsAt: { gt: now },
                  },
                },
                orderBy: { discountPercent: "desc" },
                take: 1,
                select: { discountPercent: true },
              },
            },
          });
          if (!product) {
            throw new InventoryConflictError(`Product is not available: ${line.productId}`);
          }

          const updated = await transaction.product.updateMany({
            where: {
              id: product.id,
              isActive: true,
              sku: product.sku,
              name: product.name,
              priceCop: product.priceCop,
              stock: { gte: line.quantity },
            },
            data: { stock: { decrement: line.quantity } },
          });
          if (updated.count !== 1) {
            throw new InventoryConflictError(
              `Insufficient stock or catalog changed: ${product.sku}`,
            );
          }

          reservedProducts.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            quantity: line.quantity,
            unitPriceCop: Math.round(
              (product.priceCop * (100 - (product.promotions[0]?.discountPercent ?? 0))) / 100,
            ),
          });
        }

        const created = await transaction.inventoryReservation.create({
          data: {
            orderId,
            requestLines: requestLines as never,
            status: "RESERVED",
            items: { create: reservedProducts },
            movements: {
              create: reservedProducts.map((line) => ({
                productId: line.productId,
                movementType: "RESERVE",
                quantityDelta: -line.quantity,
              })),
            },
          },
          include: { items: { orderBy: { productId: "asc" } } },
        });

        return {
          orderId: created.orderId,
          status: "RESERVED",
          reservedAt: created.createdAt.toISOString(),
          lines: created.items.map((line) => ({
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            quantity: line.quantity,
            unitPriceCop: line.unitPriceCop,
          })),
        };
      });
    } catch (error) {
      // Two service replicas may race to create the same idempotent reservation.
      // The loser rolls back its stock updates and returns the winner's snapshot.
      const existing = await this.prisma.inventoryReservation.findUnique({
        where: { orderId },
        include: { items: { orderBy: { productId: "asc" } } },
      });
      if (existing) {
        return this.returnExistingReservation(existing, requestLines);
      }
      throw error;
    }
  }

  public async reserveInventory(orderId: string, lines: ReservationRequestLine[], _expiresAt: Date): Promise<InventoryReservation> {
    const reservation = await this.reserveProducts(orderId, lines);
    return { ...reservation, status: "ACTIVE" };
  }

  public async commitInventory(orderId: string): Promise<InventoryReservation> {
    return this.prisma.$transaction(async (transaction) => {
      const reservation = await transaction.inventoryReservation.findUnique({
        where: { orderId },
        include: { items: true },
      });
      if (!reservation) throw Object.assign(new Error("Reservation not found"), { code: "NOT_FOUND" });
      if (reservation.status === "COMMITTED") {
        return this.mapReservation(reservation, "COMMITTED");
      }
      if (reservation.status !== "RESERVED") {
        throw Object.assign(new Error("Reservation cannot be committed"), { code: "CONFLICT" });
      }

      const updated = await transaction.inventoryReservation.updateMany({
        where: { orderId, status: "RESERVED" },
        data: { status: "COMMITTED" },
      });
      if (updated.count !== 1) {
        const current = await transaction.inventoryReservation.findUnique({
          where: { orderId },
          include: { items: true },
        });
        if (current?.status === "COMMITTED") {
          return this.mapReservation(current, "COMMITTED");
        }
        throw Object.assign(new Error("Reservation cannot be committed"), { code: "CONFLICT" });
      }

      return this.mapReservation(reservation, "COMMITTED");
    });
  }

  public async releaseInventory(orderId: string): Promise<InventoryReservation> {
    return this.prisma.$transaction(async (transaction) => {
      const reservation = await transaction.inventoryReservation.findUnique({
        where: { orderId },
        include: { items: true },
      });
      if (!reservation) throw Object.assign(new Error("Reservation not found"), { code: "NOT_FOUND" });
      if (reservation.status === "RELEASED") {
        return this.mapReservation(reservation, "RELEASED");
      }
      if (reservation.status === "COMMITTED") {
        throw Object.assign(new Error("Committed reservation cannot be released"), { code: "CONFLICT" });
      }

      const updated = await transaction.inventoryReservation.updateMany({
        where: { orderId, status: "RESERVED" },
        data: { status: "RELEASED" },
      });
      if (updated.count !== 1) {
        const current = await transaction.inventoryReservation.findUnique({
          where: { orderId },
          include: { items: true },
        });
        if (current?.status === "RELEASED") {
          return this.mapReservation(current, "RELEASED");
        }
        throw Object.assign(new Error("Reservation cannot be released"), { code: "CONFLICT" });
      }

      for (const item of reservation.items) {
        await transaction.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      return this.mapReservation(reservation, "RELEASED");
    });
  }

  private mapReservation(
    reservation: { orderId: string; createdAt: Date; items: Array<{ productId: string; sku: string; name: string; quantity: number; unitPriceCop: number }> },
    status: InventoryReservation["status"],
  ): InventoryReservation {
    return {
      orderId: reservation.orderId,
      status,
      reservedAt: reservation.createdAt.toISOString(),
      lines: reservation.items.map((line) => ({ ...line })),
    };
  }

  private mapManualSale(sale: {
    idempotencyKey: string;
    adminCustomerId: string;
    createdAt: Date;
    lines: Array<{ productId: string; sku: string; name: string; quantity: number; unitPriceCop: number }>;
  }): ManualSale {
    return {
      idempotencyKey: sale.idempotencyKey,
      adminCustomerId: sale.adminCustomerId,
      createdAt: sale.createdAt.toISOString(),
      lines: sale.lines.map(({ productId, sku, name, quantity, unitPriceCop }) => ({
        productId,
        sku,
        name,
        quantity,
        unitPriceCop,
      })),
    };
  }

  private mapStockReceipt(receipt: {
    idempotencyKey: string;
    adminCustomerId: string;
    reason: string;
    createdAt: Date;
    lines: Array<{ productId: string; sku: string; name: string; quantity: number }>;
  }): StockReceipt {
    return {
      idempotencyKey: receipt.idempotencyKey,
      adminCustomerId: receipt.adminCustomerId,
      reason: receipt.reason,
      createdAt: receipt.createdAt.toISOString(),
      lines: receipt.lines.map(({ productId, sku, name, quantity }) => ({
        productId,
        sku,
        name,
        quantity,
      })),
    };
  }

  private returnExistingStockReceipt(
    receipt: {
      idempotencyKey: string;
      adminCustomerId: string;
      reason: string;
      requestFingerprint: string;
      createdAt: Date;
      lines: Array<{ productId: string; sku: string; name: string; quantity: number }>;
    },
    requestFingerprint: string,
  ): StockReceipt {
    if (receipt.requestFingerprint !== requestFingerprint) {
      throw new StockReceiptIdempotencyConflictError();
    }
    return this.mapStockReceipt(receipt);
  }

  private returnExistingManualSale(
    existing: {
      idempotencyKey: string;
      adminCustomerId: string;
      createdAt: Date;
      requestLines: unknown;
      lines: Array<{ productId: string; sku: string; name: string; quantity: number; unitPriceCop: number }>;
    },
    requestLines: ReservationRequestLine[],
  ): ManualSale {
    let existingRequest: ReservationRequestLine[];
    try {
      existingRequest = normalizeReservationLines(existing.requestLines as ReservationRequestLine[]);
    } catch {
      throw new ManualSaleIdempotencyConflictError();
    }
    if (JSON.stringify(existingRequest) !== JSON.stringify(requestLines)) {
      throw new ManualSaleIdempotencyConflictError();
    }
    return this.mapManualSale(existing);
  }

  private returnExistingReservation(
    existing: {
      orderId: string;
      status: string;
      requestLines: unknown;
      createdAt: Date;
      items: Array<{
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        unitPriceCop: number;
      }>;
    },
    requestLines: ReservationRequestLine[],
  ): InventoryReservation {
    let existingRequest: ReservationRequestLine[];
    try {
      existingRequest = normalizeReservationLines(
        existing.requestLines as ReservationRequestLine[],
      );
    } catch {
      throw new ReservationIdempotencyConflictError();
    }

    if (
      JSON.stringify(existingRequest) !== JSON.stringify(requestLines) ||
      existing.status !== "RESERVED"
    ) {
      throw new ReservationIdempotencyConflictError();
    }

    return {
      orderId: existing.orderId,
      status: "RESERVED",
      reservedAt: existing.createdAt.toISOString(),
      lines: existing.items.map((line) => ({
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPriceCop: line.unitPriceCop,
      })),
    };
  }
}
