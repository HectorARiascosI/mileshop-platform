import { Module } from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";

@Module({
  controllers: [GatewayController],
  providers: [
    {
      provide: "CATALOG_FETCH",
      useValue: fetch,
    },
    CatalogClient,
  ],
})
export class AppModule {}
