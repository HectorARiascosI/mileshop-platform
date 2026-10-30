import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";

import { CatalogUnavailableError } from "./catalog.reader.js";
import { OrdersService } from "./orders.service.js";
import { InvalidOrderError, OrderConflictError } from "./orders.validation.js";

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
  public async createOrder(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<OrdersService["createOrder"]>> }> {
    try {
      return { data: await this.orders.createOrder(body, idempotencyKey) };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof InvalidOrderError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof OrderConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get("orders/:orderId")
  public async getOrder(@Param("orderId") orderId: string): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const result = await this.orders.getOrderById(orderId);

    if (result === null) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return { data: result };
  }
}
