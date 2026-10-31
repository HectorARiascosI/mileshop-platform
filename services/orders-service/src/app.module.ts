import { Module } from "@nestjs/common";

import { HttpCatalogReader } from "./catalog.reader.js";
import { OrdersController } from "./orders.controller.js";
import {
  HttpOrderEventPublisher,
  NOTIFICATION_WORKER_URL,
  ORDER_EVENT_PUBLISHER,
  OrdersService,
  PrismaOrderEventOutbox,
} from "./orders.service.js";
import { PrismaOrdersRepository } from "./prisma.orders.repository.js";
import { PrismaService } from "./prisma.service.js";

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
      useFactory: (workerUrl: string) => new HttpOrderEventPublisher(fetch, workerUrl),
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
        fetch,
        process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020",
        process.env.CATALOG_RESERVATION_TOKEN,
      ),
    },
  ],
})
export class AppModule {}
