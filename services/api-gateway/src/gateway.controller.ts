import { Body, Controller, Get, Post } from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";
import { OrderService, type CreateOrderInput } from "./orders.service.js";

@Controller()
export class GatewayController {
  public constructor(
    private readonly catalog: CatalogClient,
    private readonly orders: OrderService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("catalog/products")
  public async products(): Promise<{ data: Awaited<ReturnType<CatalogClient["listProducts"]>> }> {
    return { data: await this.catalog.listProducts() };
  }

  @Post("orders")
  public async createOrder(@Body() input: CreateOrderInput): Promise<{ data: Awaited<ReturnType<OrderService["createOrder"]>> }> {
    return { data: await this.orders.createOrder(input) };
  }
}
