import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";
import { IdentityClient } from "./identity.client.js";
import { OrderService, type CreateOrderInput } from "./orders.service.js";

@Controller()
export class GatewayController {
  public constructor(
    private readonly catalog: CatalogClient,
    private readonly orders: OrderService,
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
}
