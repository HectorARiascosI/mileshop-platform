import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
} from "@nestjs/common";

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

  @Post("events/order-created")
  public async orderCreated(@Body() body: unknown): Promise<{ status: string }> {
    const parsed = orderCreatedSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid OrderCreated.v1 event");
    }

    const status = await this.worker.handleOrderCreated(parsed.data);
    return { status };
  }
}
