import { Prisma, PrismaClient } from "../generated/catalog-client/index.js";

import {
  InventoryCommandError,
  inventoryFingerprint,
  normalizeInventoryLines,
  validateInventoryOrderId,
  validateReservationExpiry,
  type CatalogStore,
  type InventoryReservationResult,
  type InventoryReservationStatus,
  type NormalizedInventoryLine,
  type Product,
} from "./catalog.service.js";

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
        reservedStock: true,
      },
    });
    return products.map(({ reservedStock, ...product }) => ({
      ...product,
      stock: product.stock - reservedStock,
    }));
  }

  public async reserveInventory(
    orderId: string,
    lines: NormalizedInventoryLine[],
    expiresAt: Date,
  ): Promise<InventoryReservationResult> {
    validateInventoryOrderId(orderId);
    const normalizedLines = normalizeInventoryLines(lines);
    const requestFingerprint = inventoryFingerprint(normalizedLines);
    const existing = await this.prisma.inventoryReservation.findUnique({
      where: { orderId },
    });
    if (existing) {
      return this.resolveReservationReplay(existing, requestFingerprint);
    }
    validateReservationExpiry(expiresAt);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const concurrentReservation = await transaction.inventoryReservation.findUnique({
          where: { orderId },
        });
        if (concurrentReservation) {
          return this.resolveReservationReplay(concurrentReservation, requestFingerprint);
        }

        const reservation = await transaction.inventoryReservation.create({
          data: { orderId, requestFingerprint, expiresAt },
        });

        for (const line of normalizedLines) {
          const updated = await transaction.$executeRaw(Prisma.sql`
            UPDATE "Product"
            SET "reservedStock" = "reservedStock" + ${line.quantity},
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${line.productId}
              AND "isActive" = TRUE
              AND ("stock" - "reservedStock") >= ${line.quantity}
          `);
          if (updated !== 1) {
            const product = await transaction.product.findUnique({
              where: { id: line.productId },
              select: { isActive: true },
            });
            if (!product || !product.isActive) {
              throw new InventoryCommandError(
                "NOT_FOUND",
                `Active product not found: ${line.productId}`,
              );
            }
            throw new InventoryCommandError(
              "INSUFFICIENT_INVENTORY",
              `Insufficient inventory for product: ${line.productId}`,
            );
          }
        }

        await transaction.inventoryReservationLine.createMany({
          data: normalizedLines.map((line) => ({
            reservationId: reservation.id,
            productId: line.productId,
            quantity: line.quantity,
          })),
        });
        return {
          orderId,
          status: reservation.status,
          expiresAt: reservation.expiresAt,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const concurrentReservation = await this.prisma.inventoryReservation.findUnique({
        where: { orderId },
      });
      if (!concurrentReservation) {
        throw error;
      }
      return this.resolveReservationReplay(concurrentReservation, requestFingerprint);
    }
  }

  public async commitInventory(orderId: string): Promise<InventoryReservationResult> {
    validateInventoryOrderId(orderId);
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.inventoryReservation.updateMany({
        where: { orderId, status: "ACTIVE" },
        data: { status: "COMMITTED" },
      });
      if (updated.count !== 1) {
        return this.resolveFinishedReservation(
          transaction,
          orderId,
          "COMMITTED",
          "Cannot commit a released reservation",
        );
      }

      const reservation = await transaction.inventoryReservation.findUniqueOrThrow({
        where: { orderId },
        include: { lines: { orderBy: { productId: "asc" } } },
      });
      for (const line of reservation.lines) {
        const affected = await transaction.$executeRaw(Prisma.sql`
          UPDATE "Product"
          SET "stock" = "stock" - ${line.quantity},
              "reservedStock" = "reservedStock" - ${line.quantity},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${line.productId}
            AND "stock" >= ${line.quantity}
            AND "reservedStock" >= ${line.quantity}
        `);
        if (affected !== 1) {
          throw new Error(`Inventory counters are inconsistent for product: ${line.productId}`);
        }
      }

      return {
        orderId,
        status: "COMMITTED",
        expiresAt: reservation.expiresAt,
      };
    });
  }

  public async releaseInventory(orderId: string): Promise<InventoryReservationResult> {
    validateInventoryOrderId(orderId);
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.inventoryReservation.updateMany({
        where: { orderId, status: "ACTIVE" },
        data: { status: "RELEASED" },
      });
      if (updated.count !== 1) {
        return this.resolveFinishedReservation(
          transaction,
          orderId,
          "RELEASED",
          "Cannot release a committed reservation",
        );
      }

      const reservation = await transaction.inventoryReservation.findUniqueOrThrow({
        where: { orderId },
        include: { lines: { orderBy: { productId: "asc" } } },
      });
      for (const line of reservation.lines) {
        const affected = await transaction.$executeRaw(Prisma.sql`
          UPDATE "Product"
          SET "reservedStock" = "reservedStock" - ${line.quantity},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${line.productId}
            AND "reservedStock" >= ${line.quantity}
        `);
        if (affected !== 1) {
          throw new Error(`Reserved inventory counter is inconsistent for product: ${line.productId}`);
        }
      }

      return {
        orderId,
        status: "RELEASED",
        expiresAt: reservation.expiresAt,
      };
    });
  }

  private resolveReservationReplay(
    reservation: {
      orderId: string;
      status: InventoryReservationStatus;
      requestFingerprint: string;
      expiresAt: Date;
    },
    requestFingerprint: string,
  ): InventoryReservationResult {
    if (reservation.requestFingerprint !== requestFingerprint) {
      throw new InventoryCommandError(
        "CONFLICT",
        "The order already has a reservation with a different payload",
      );
    }
    return {
      orderId: reservation.orderId,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
    };
  }

  private async resolveFinishedReservation(
    transaction: Prisma.TransactionClient,
    orderId: string,
    replayStatus: InventoryReservationStatus,
    conflictMessage: string,
  ): Promise<InventoryReservationResult> {
    const reservation = await transaction.inventoryReservation.findUnique({
      where: { orderId },
    });
    if (!reservation) {
      throw new InventoryCommandError(
        "NOT_FOUND",
        `Reservation not found for order: ${orderId}`,
      );
    }
    if (reservation.status !== replayStatus) {
      throw new InventoryCommandError("CONFLICT", conflictMessage);
    }
    return {
      orderId,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002";
}
