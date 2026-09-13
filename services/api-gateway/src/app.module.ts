import { Module } from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";

@Module({
  controllers: [GatewayController],
  providers: [CatalogClient],
})
export class AppModule {}
