import { PrismaClient } from "../generated/catalog-client/index.js";

import {
  InventoryConflictError,
  ReservationIdempotencyConflictError,
  normalizeReservationLines,
} from "./catalog.service.js";
import type {
  CatalogStore,
  InventoryReservation,
  Product,
  ReservationRequestLine,
} from "./catalog.service.js";

export class PrismaCatalogStore implements CatalogStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listActiveProducts(): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        priceCop: true,
        stock: true,
      },
    });
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
    const reservation = await this.prisma.inventoryReservation.findUnique({ where: { orderId }, include: { items: true } });
    if (!reservation) throw Object.assign(new Error("Reservation not found"), { code: "NOT_FOUND" });
    if (reservation.status === "COMMITTED") return this.mapReservation(reservation, "COMMITTED");
    if (reservation.status !== "RESERVED") throw Object.assign(new Error("Reservation cannot be committed"), { code: "CONFLICT" });
    await this.prisma.inventoryReservation.update({ where: { orderId }, data: { status: "COMMITTED" } });
    return this.mapReservation(reservation, "COMMITTED");
  }

  public async releaseInventory(orderId: string): Promise<InventoryReservation> {
    const reservation = await this.prisma.inventoryReservation.findUnique({ where: { orderId }, include: { items: true } });
    if (!reservation) throw Object.assign(new Error("Reservation not found"), { code: "NOT_FOUND" });
    if (reservation.status === "RELEASED") return this.mapReservation(reservation, "RELEASED");
    if (reservation.status === "COMMITTED") throw Object.assign(new Error("Committed reservation cannot be released"), { code: "CONFLICT" });
    await this.prisma.$transaction(async (transaction) => {
      for (const item of reservation.items) {
        await transaction.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
      }
      await transaction.inventoryReservation.update({ where: { orderId }, data: { status: "RELEASED" } });
    });
    return this.mapReservation(reservation, "RELEASED");
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
