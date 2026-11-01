import { Module } from "@nestjs/common";

import { HttpCatalogReader } from "./catalog.reader.js";
import { OrdersController } from "./orders.controller.js";
import {
  HttpInventoryCommandDispatcher,
  InventoryCommandWorker,
} from "./inventory-command.worker.js";
import {
  HttpOrderEventPublisher,
  NOTIFICATION_WORKER_URL,
  ORDER_EVENT_PUBLISHER,
  OrdersService,
  PrismaOrderEventOutbox,
} from "./orders.service.js";
import { PrismaOrdersRepository } from "./prisma.orders.repository.js";
import { PrismaService } from "./prisma.service.js";
import { ORDERS_INTERNAL_TOKEN } from "./payment-evidence/gateway-internal.guard.js";
import { createPreviewProtectedFetch } from "./preview-protected-fetch.js";

const catalogFetch = createPreviewProtectedFetch(
  process.env.VERCEL_CATALOG_BYPASS_SECRET,
);
const notificationFetch = createPreviewProtectedFetch(
  process.env.VERCEL_NOTIFICATIONS_BYPASS_SECRET,
);

@Module({
  controllers: [OrdersController],
  providers: [
    PrismaService,
    {
      provide: "ORDERS_REPOSITORY",
      useFactory: (prisma: PrismaService) => new PrismaOrdersRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: NOTIFICATION_WORKER_URL,
      useValue: process.env.NOTIFICATION_WORKER_URL ?? "http://localhost:3010",
    },
    {
      provide: ORDER_EVENT_PUBLISHER,
      useFactory: (workerUrl: string) => new HttpOrderEventPublisher(notificationFetch, workerUrl),
      inject: [NOTIFICATION_WORKER_URL],
    },
    {
      provide: "ORDER_EVENT_OUTBOX",
      useFactory: (prisma: PrismaService) => new PrismaOrderEventOutbox(prisma),
      inject: [PrismaService],
    },
    {
      provide: "ORDERS_SERVICE",
      useFactory: (
        repository: PrismaOrdersRepository,
        catalog: HttpCatalogReader,
        publisher: HttpOrderEventPublisher,
        outbox: PrismaOrderEventOutbox,
      ) => new OrdersService(repository, catalog, publisher, outbox),
      inject: ["ORDERS_REPOSITORY", "CATALOG_READER", ORDER_EVENT_PUBLISHER, "ORDER_EVENT_OUTBOX"],
    },
    {
      provide: "CATALOG_READER",
      useFactory: () => new HttpCatalogReader(
        catalogFetch,
        process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020",
        process.env.CATALOG_RESERVATION_TOKEN,
      ),
    },
    {
      provide: "INVENTORY_COMMAND_REPOSITORY",
      useFactory: (repository: PrismaOrdersRepository) => repository,
      inject: ["ORDERS_REPOSITORY"],
    },
    {
      provide: "INVENTORY_COMMAND_DISPATCHER",
      useFactory: () => new HttpInventoryCommandDispatcher(
        catalogFetch,
        process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020",
        process.env.CATALOG_INVENTORY_COMMAND_TOKEN ?? "",
      ),
    },
    InventoryCommandWorker,
    {
      provide: "INVENTORY_COMMAND_WORKER",
      useExisting: InventoryCommandWorker,
    },
    {
      provide: ORDERS_INTERNAL_TOKEN,
      useValue: process.env.ORDERS_INTERNAL_TOKEN || "local-development-orders-internal-token",
    },
  ],
})
export class AppModule {}
