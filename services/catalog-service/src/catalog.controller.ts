import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Post,
  Body,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { CatalogService, InventoryCommandError } from "./catalog.service.js";
import { InventoryCommandGuard } from "./inventory-command.guard.js";

const inventoryLineSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().safe(),
}).strict();

const reserveInventorySchema = z.object({
  commandId: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(200),
  lines: z.array(inventoryLineSchema).min(1).max(100),
  expiresAt: z.iso.datetime(),
}).strict();

const settleInventorySchema = z.object({
  commandId: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(200),
}).strict();

@Controller()
export class CatalogController {
  public constructor(
    @Inject("CATALOG_SERVICE") private readonly catalog: CatalogService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("products")
  public async products(): Promise<{ data: Awaited<ReturnType<CatalogService["listProducts"]>> }> {
    return { data: await this.catalog.listProducts() };
  }

  @Post("internal/inventory/reservations")
  @UseGuards(InventoryCommandGuard)
  public async reserveInventory(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["reserveInventory"]>> }> {
    const input = this.parse(reserveInventorySchema, body);
    this.validateIdempotencyKey(idempotencyKey, input.orderId);
    return {
      data: await this.runInventoryCommand(() =>
        this.catalog.reserveInventory(input.orderId, input.lines, new Date(input.expiresAt))),
    };
  }

  @Post("internal/inventory/reservations/commit")
  @UseGuards(InventoryCommandGuard)
  public async commitInventory(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["commitInventory"]>> }> {
    const input = this.parse(settleInventorySchema, body);
    this.validateIdempotencyKey(idempotencyKey, input.orderId);
    return {
      data: await this.runInventoryCommand(() =>
        this.catalog.commitInventory(input.orderId)),
    };
  }

  @Post("internal/inventory/reservations/release")
  @UseGuards(InventoryCommandGuard)
  public async releaseInventory(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<CatalogService["releaseInventory"]>> }> {
    const input = this.parse(settleInventorySchema, body);
    this.validateIdempotencyKey(idempotencyKey, input.orderId);
    return {
      data: await this.runInventoryCommand(() =>
        this.catalog.releaseInventory(input.orderId)),
    };
  }

  private parse<Output>(
    schema: z.ZodType<Output>,
    body: unknown,
  ): Output {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return parsed.data;
  }

  private validateIdempotencyKey(
    idempotencyKey: string | undefined,
    orderId: string,
  ): void {
    if (idempotencyKey !== orderId) {
      throw new BadRequestException("Idempotency-Key must match the order ID");
    }
  }

  private async runInventoryCommand<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      if (!(error instanceof InventoryCommandError)) {
        throw error;
      }
      if (error.code === "INVALID_COMMAND") {
        throw new BadRequestException(error.message);
      }
      if (error.code === "NOT_FOUND") {
        throw new NotFoundException(error.message);
      }
      if (error.code === "INSUFFICIENT_INVENTORY") {
        throw new ConflictException(error.message);
      }
      throw new ConflictException(error.message);
    }
  }
}
