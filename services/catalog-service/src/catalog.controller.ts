import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import {
  CatalogService,
  InventoryConflictError,
  ReservationIdempotencyConflictError,
} from "./catalog.service.js";
import type {
  InventoryReservation,
  ReservationRequestLine,
} from "./catalog.service.js";

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

    try {
      return { data: await this.catalog.reserveProducts(input.orderId, lines) };
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
}
