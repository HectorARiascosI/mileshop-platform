import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  HttpException,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";

import { CatalogUnavailableError } from "./catalog.reader.js";
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

  @Get("readyz")
  public readiness(): { status: "ready" } {
    return { status: "ready" };
  }

  @Post("orders")
  public async createOrder(
    @Body() body: Omit<CreateOrderInput, "idempotencyKey">,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<OrdersService["createOrder"]>> }> {
    try {
      return {
        data: await this.orders.createOrder({
          ...body,
          idempotencyKey: idempotencyKey ?? "",
        }),
      };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(error instanceof Error ? error.message : "Invalid order payload");
    }
  }

  @Get("orders/:orderId")
  public async getOrder(
    @Param("orderId") orderId: string,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const result = await this.orders.getOrderById(orderId);

    if (result === null) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return { data: result };
  }
}
