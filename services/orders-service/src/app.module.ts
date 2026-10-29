import { Module } from "@nestjs/common";

import { HttpCatalogReader } from "./catalog.reader.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
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
      provide: "ORDERS_SERVICE",
      useFactory: (repository: PrismaOrdersRepository, catalog: HttpCatalogReader) =>
        new OrdersService(repository, catalog),
      inject: ["ORDERS_REPOSITORY", "CATALOG_READER"],
    },
    {
      provide: "CATALOG_READER",
      useFactory: () => new HttpCatalogReader(
        fetch,
        process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020",
      ),
    },
  ],
})
export class AppModule {}
