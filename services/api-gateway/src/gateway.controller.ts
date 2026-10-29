import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
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
    @Req() req: { customerId?: string },
  ): Promise<{ data: Awaited<ReturnType<OrderService["createOrder"]>> }> {
    // customerId is overwritten with the verified value injected by AuthMiddleware.
    // The client-supplied value is intentionally discarded when a verified identity exists.
    const order = await this.orders.createOrder({
      customerId: req.customerId ?? input.customerId,
      lines: input.lines,
    });
    return { data: order };
  }
}
