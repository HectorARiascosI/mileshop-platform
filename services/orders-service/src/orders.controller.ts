import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";

import { OrdersService } from "./orders.service.js";
import type { CreateOrderInput } from "./orders.types.js";

@Controller()
export class OrdersController {
  public constructor(
    @Inject("ORDERS_SERVICE") private readonly orders: OrdersService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Post("orders")
  public async createOrder(@Body() body: CreateOrderInput): Promise<{ data: Awaited<ReturnType<OrdersService["createOrder"]>> }> {
    return { data: await this.orders.createOrder(body) };
  }

  @Get("orders/:orderId")
  public async getOrder(@Param("orderId") orderId: string): Promise<{ data: Awaited<ReturnType<OrdersService["getOrderById"]>> }> {
    return { data: await this.orders.getOrderById(orderId) };
  }
}
