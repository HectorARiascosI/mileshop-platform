import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { orderCreatedSchema } from "./events.js";
import { NotificationWorker } from "./notification.worker.js";

@Controller()
export class NotificationsController {
  public constructor(
    @Inject("NOTIFICATION_WORKER") private readonly worker: NotificationWorker,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  public readiness(): { status: "ready" } {
    return { status: "ready" };
  }

  @Post("events/order-created")
  public async orderCreated(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<{ status: string }> {
    const parsed = orderCreatedSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid OrderCreated.v1 event");
    }

    const status = await this.worker.handleOrderCreated(parsed.data);
    response.code(status === "processing" ? 202 : 200);
    return { status };
  }
}
