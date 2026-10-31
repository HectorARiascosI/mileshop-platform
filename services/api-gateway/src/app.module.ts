import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";

import { AuthMiddleware, IDENTITY_SERVICE_URL } from "./auth.middleware.js";
import { CATALOG_FETCH, CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";
import { IDENTITY_FETCH, IdentityClient } from "./identity.client.js";
import { StoreAdminGuard } from "./store-admin.guard.js";
import {
  ORDER_FETCH,
  ORDERS_INTERNAL_TOKEN,
  ORDERS_SERVICE_URL,
  OrderService,
} from "./orders.service.js";

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
      provide: ORDERS_INTERNAL_TOKEN,
      useValue: process.env.ORDERS_INTERNAL_TOKEN ?? "",
    },
    {
      provide: IDENTITY_SERVICE_URL,
      useValue: process.env.IDENTITY_SERVICE_URL ?? "http://localhost:3040",
    },
    AuthMiddleware,
    StoreAdminGuard,
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
      { path: "orders/:orderId/cancel", method: RequestMethod.POST },
      { path: "orders/:orderId/cancellation-request", method: RequestMethod.POST },
      { path: "orders/:orderId/payment-evidence", method: RequestMethod.POST },
      { path: "orders/:orderId/payment-evidence", method: RequestMethod.GET },
      { path: "admin/payments", method: RequestMethod.GET },
      { path: "admin/cancellation-requests", method: RequestMethod.GET },
      {
        path: "admin/cancellation-requests/:orderId/refund-handling",
        method: RequestMethod.POST,
      },
      {
        path: "admin/cancellation-requests/:orderId/resolve",
        method: RequestMethod.POST,
      },
      { path: "admin/payments/:orderId", method: RequestMethod.GET },
      { path: "admin/payments/:orderId/evidence", method: RequestMethod.GET },
      { path: "admin/payments/:orderId/evidence", method: RequestMethod.POST },
      { path: "admin/payments/:orderId/approve", method: RequestMethod.POST },
      { path: "admin/payments/:orderId/reject", method: RequestMethod.POST },
      { path: "admin/payment-evidence/:orderId/legal-hold", method: RequestMethod.POST },
      { path: "admin/payment-evidence/:orderId/legal-hold", method: RequestMethod.DELETE },
    );
  }
}
