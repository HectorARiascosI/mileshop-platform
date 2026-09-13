import { Module } from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";
import { OrderService } from "./orders.service.js";

@Module({
  controllers: [GatewayController],
  providers: [
    {
      provide: "CATALOG_FETCH",
      useValue: fetch,
    },
    {
      provide: "ORDER_FETCH",
      useValue: fetch,
    },
    CatalogClient,
    OrderService,
  ],
})
export class AppModule {}
