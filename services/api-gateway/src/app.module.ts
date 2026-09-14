import { Module } from "@nestjs/common";

import { CATALOG_FETCH, CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";
import { NOTIFICATION_WORKER_URL, ORDER_FETCH, OrderService } from "./orders.service.js";

@Module({
  controllers: [GatewayController],
  providers: [
    {
      provide: CATALOG_FETCH,
      useValue: fetch,
    },
    {
      provide: ORDER_FETCH,
      useValue: fetch,
    },
    {
      provide: NOTIFICATION_WORKER_URL,
      useValue: process.env.NOTIFICATION_WORKER_URL ?? "http://localhost:3010",
    },
    CatalogClient,
    OrderService,
  ],
})
export class AppModule {}
