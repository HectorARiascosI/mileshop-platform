import { PrismaClient } from "../generated/catalog-client/index.js";

import {
  CatalogConflictError,
  CatalogNotFoundError,
  InventoryConflictError,
  ManualSaleIdempotencyConflictError,
  ReservationIdempotencyConflictError,
  StockReceiptIdempotencyConflictError,
  normalizeCategoryInput,
  normalizeProductInput,
  normalizeReservationLines,
  normalizeStockReceipt,
} from "./catalog.service.js";
import type {
  CatalogStore,
  Category,
  CategoryInput,
  InventoryReservation,
  ManualSale,
  ProductInput,
  Product,
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

export class PrismaCatalogStore implements CatalogStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listActiveProducts(): Promise<Product[]> {
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
        category: {
          select: { id: true, name: true, slug: true, theme: true },
        },
      },
    });
    return products.map(({ imageUrl, category, ...product }) => ({
      ...product,
      ...(imageUrl ? { imageUrl } : {}),
      ...(category ? { category } : {}),
    }));
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

  public async createProduct(input: ProductInput): Promise<Product> {
    const normalized = normalizeProductInput(input);
    try {
      return await this.prisma.product.create({
        data: { ...normalized, stock: 0 },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          priceCop: true,
          stock: true,
          imageUrl: true,
          imageFileId: true,
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
      return await this.prisma.product.update({
        where: { id: productId },
        data: normalized,
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          priceCop: true,
          stock: true,
          imageUrl: true,
          imageFileId: true,
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
            select: { id: true, sku: true, name: true, priceCop: true },
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
            unitPriceCop: product.priceCop,
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
            select: { id: true, sku: true, name: true, priceCop: true },
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
            unitPriceCop: product.priceCop,
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
