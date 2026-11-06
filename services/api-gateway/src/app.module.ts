import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";

import { AuthMiddleware, IDENTITY_SERVICE_URL } from "./auth.middleware.js";
import { CATALOG_FETCH, CatalogClient } from "./catalog.client.js";
import { GatewayController } from "./gateway.controller.js";
import { IDENTITY_FETCH, IdentityClient } from "./identity.client.js";
import { ORDER_FETCH, ORDERS_INTERNAL_TOKEN, ORDERS_SERVICE_URL, OrderService } from "./orders.service.js";
import { createPreviewProtectedFetch } from "./preview-protected-fetch.js";
import { StoreAdminGuard } from "./store-admin.guard.js";

const catalogFetch = createPreviewProtectedFetch(
  process.env.VERCEL_CATALOG_BYPASS_SECRET,
);
const identityFetch = createPreviewProtectedFetch(
  process.env.VERCEL_IDENTITY_BYPASS_SECRET,
);
const ordersFetch = createPreviewProtectedFetch(
  process.env.VERCEL_ORDERS_BYPASS_SECRET,
);

export const AUTHENTICATED_ROUTES = [
  { path: "orders", method: RequestMethod.POST },
  { path: "orders/:orderId", method: RequestMethod.GET },
  { path: "orders/:orderId/cancel", method: RequestMethod.POST },
  { path: "orders/:orderId/cancellation-request", method: RequestMethod.POST },
  { path: "orders/:orderId/payment-evidence", method: RequestMethod.POST },
  { path: "orders/:orderId/payment-evidence", method: RequestMethod.GET },
  { path: "admin/payments", method: RequestMethod.GET },
  { path: "admin/orders", method: RequestMethod.GET },
  { path: "admin/orders/:orderId/confirm", method: RequestMethod.POST },
  { path: "admin/orders/:orderId/payment-reported", method: RequestMethod.POST },
  { path: "admin/orders/:orderId/cancel", method: RequestMethod.POST },
  { path: "admin/catalog/manual-sales", method: RequestMethod.POST },
  { path: "admin/catalog/products", method: RequestMethod.GET },
  { path: "admin/catalog/products", method: RequestMethod.POST },
  { path: "admin/catalog/products/:productId", method: RequestMethod.PATCH },
  { path: "admin/catalog/products/:productId", method: RequestMethod.DELETE },
  { path: "admin/catalog/categories", method: RequestMethod.GET },
  { path: "admin/catalog/categories", method: RequestMethod.POST },
  { path: "admin/catalog/categories/:categoryId", method: RequestMethod.PATCH },
  { path: "admin/catalog/categories/:categoryId", method: RequestMethod.DELETE },
  { path: "admin/catalog/promotions", method: RequestMethod.GET },
  { path: "admin/catalog/promotions", method: RequestMethod.POST },
  { path: "admin/catalog/promotions/:promotionId", method: RequestMethod.PATCH },
  { path: "admin/catalog/promotions/:promotionId", method: RequestMethod.DELETE },
  { path: "admin/catalog/announcements", method: RequestMethod.GET },
  { path: "admin/catalog/announcements", method: RequestMethod.POST },
  { path: "admin/catalog/announcements/:announcementId", method: RequestMethod.PATCH },
  { path: "admin/catalog/announcements/:announcementId", method: RequestMethod.DELETE },
  { path: "admin/catalog/stock-receipts", method: RequestMethod.POST },
  { path: "admin/payments/:orderId", method: RequestMethod.GET },
  { path: "admin/payments/:orderId/evidence", method: RequestMethod.POST },
  { path: "admin/payments/:orderId/evidence", method: RequestMethod.GET },
  { path: "admin/payments/:orderId/approve", method: RequestMethod.POST },
  { path: "admin/payments/:orderId/reject", method: RequestMethod.POST },
  { path: "admin/cancellation-requests", method: RequestMethod.GET },
  { path: "admin/cancellation-requests/:orderId/refund-handling", method: RequestMethod.POST },
  { path: "admin/cancellation-requests/:orderId/resolve", method: RequestMethod.POST },
  { path: "admin/payment-evidence/:orderId/legal-hold", method: RequestMethod.POST },
  { path: "admin/payment-evidence/:orderId/legal-hold", method: RequestMethod.DELETE },
] as const;

@Module({
  controllers: [GatewayController],
  providers: [
    { provide: CATALOG_FETCH, useValue: catalogFetch },
    { provide: ORDER_FETCH, useValue: ordersFetch },
    { provide: IDENTITY_FETCH, useValue: identityFetch },
    { provide: "AUTH_FETCH", useValue: identityFetch },
    {
      provide: ORDERS_SERVICE_URL,
      useValue: process.env.ORDERS_SERVICE_URL ?? "http://localhost:3030",
    },
    {
      provide: ORDERS_INTERNAL_TOKEN,
      useValue: process.env.ORDERS_INTERNAL_TOKEN || "local-development-orders-internal-token",
    },
    {
      provide: IDENTITY_SERVICE_URL,
      useValue: process.env.IDENTITY_SERVICE_URL ?? "http://localhost:3040",
    },
    AuthMiddleware,
    CatalogClient,
    IdentityClient,
    OrderService,
    StoreAdminGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).forRoutes(...AUTHENTICATED_ROUTES);
  }
}
