import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";

import { AuthMiddleware, IDENTITY_SERVICE_URL } from "./auth.middleware.js";
import { CATALOG_FETCH, CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";
import { IDENTITY_FETCH, IdentityClient } from "./identity.client.js";
import { ORDER_FETCH, ORDERS_SERVICE_URL, OrderService } from "./orders.service.js";

@Module({
  controllers: [GatewayController],
  providers: [
    { provide: CATALOG_FETCH, useValue: fetch },
    { provide: ORDER_FETCH, useValue: fetch },
    { provide: IDENTITY_FETCH, useValue: fetch },
    { provide: "AUTH_FETCH", useValue: fetch },
    {
      provide: ORDERS_SERVICE_URL,
      useValue: process.env.ORDERS_SERVICE_URL ?? "http://localhost:3030",
    },
    {
      provide: IDENTITY_SERVICE_URL,
      useValue: process.env.IDENTITY_SERVICE_URL ?? "http://localhost:3040",
    },
    AuthMiddleware,
    CatalogClient,
    IdentityClient,
    OrderService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes(
      { path: "orders", method: RequestMethod.POST },
      { path: "orders/:orderId", method: RequestMethod.GET },
    );
  }
}
