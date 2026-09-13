import { Module } from "@nestjs/common";

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
      useFactory: (repository: PrismaOrdersRepository) => new OrdersService(repository),
      inject: ["ORDERS_REPOSITORY"],
    },
  ],
})
export class AppModule {}
