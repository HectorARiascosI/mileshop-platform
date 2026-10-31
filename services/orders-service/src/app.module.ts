import { Module } from "@nestjs/common";

import { HttpCatalogReader } from "./catalog.reader.js";
import { OrdersController } from "./orders.controller.js";
import { HttpOrderEventPublisher, OrdersService } from "./orders.service.js";
import {
  HttpInventoryCommandDispatcher,
  InventoryCommandWorker,
} from "./inventory-command.worker.js";
import { OrderExpiryWorker } from "./order-expiry.worker.js";
import {
  createPaymentEvidenceStorage,
  PAYMENT_EVIDENCE_STORAGE,
} from "./payment-evidence/payment-evidence.storage.js";
import { PaymentEvidenceService } from "./payment-evidence/payment-evidence.service.js";
import { PaymentEvidenceRetentionWorker } from "./payment-evidence/payment-evidence-retention.worker.js";
import { PrismaPaymentEvidenceRepository } from "./payment-evidence/prisma.payment-evidence.repository.js";
import {
  GatewayInternalGuard,
  ORDERS_INTERNAL_TOKEN,
} from "./payment-evidence/gateway-internal.guard.js";
import { PrismaOrdersRepository } from "./prisma.orders.repository.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [OrdersController],
  providers: [
    PrismaService,
    {
      provide: ORDERS_INTERNAL_TOKEN,
      useValue: process.env.ORDERS_INTERNAL_TOKEN ?? "",
    },
    GatewayInternalGuard,
    {
      provide: PAYMENT_EVIDENCE_STORAGE,
      useFactory: () => createPaymentEvidenceStorage(process.env),
    },
    {
      provide: "PAYMENT_EVIDENCE_REPOSITORY",
      useFactory: (prisma: PrismaService) => new PrismaPaymentEvidenceRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: "PAYMENT_EVIDENCE_SERVICE",
      useFactory: (
        repository: PrismaPaymentEvidenceRepository,
        storage: ReturnType<typeof createPaymentEvidenceStorage>,
      ) => new PaymentEvidenceService(repository, storage),
      inject: ["PAYMENT_EVIDENCE_REPOSITORY", PAYMENT_EVIDENCE_STORAGE],
    },
    {
      provide: PaymentEvidenceRetentionWorker,
      useFactory: (
        repository: PrismaPaymentEvidenceRepository,
        storage: ReturnType<typeof createPaymentEvidenceStorage>,
      ) => {
        const enabled = process.env.PAYMENT_EVIDENCE_RETENTION_ENABLED ?? "false";
        if (enabled !== "true" && enabled !== "false") {
          throw new Error("PAYMENT_EVIDENCE_RETENTION_ENABLED must be true or false");
        }
        return new PaymentEvidenceRetentionWorker(
          repository,
          storage,
          enabled === "true",
        );
      },
      inject: ["PAYMENT_EVIDENCE_REPOSITORY", PAYMENT_EVIDENCE_STORAGE],
    },
    {
      provide: "ORDERS_REPOSITORY",
      useFactory: (prisma: PrismaService) => new PrismaOrdersRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: "INVENTORY_COMMAND_REPOSITORY",
      useFactory: (prisma: PrismaService) => new PrismaOrdersRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: "INVENTORY_COMMAND_DISPATCHER",
      useFactory: () => new HttpInventoryCommandDispatcher(
        fetch,
        process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020",
        process.env.CATALOG_INVENTORY_COMMAND_TOKEN ?? "",
      ),
    },
    InventoryCommandWorker,
    {
      provide: "INVENTORY_COMMAND_WORKER",
      useExisting: InventoryCommandWorker,
    },
    OrderExpiryWorker,
    {
      provide: "ORDERS_SERVICE",
      useFactory: (
        repository: PrismaOrdersRepository,
        catalog: HttpCatalogReader,
        eventPublisher: HttpOrderEventPublisher,
        inventoryCommandWorker: InventoryCommandWorker,
      ) => new OrdersService(repository, catalog, eventPublisher, inventoryCommandWorker),
      inject: [
        "ORDERS_REPOSITORY",
        "CATALOG_READER",
        "ORDER_EVENT_PUBLISHER",
        InventoryCommandWorker,
      ],
    },
    {
      provide: "ORDER_EVENT_PUBLISHER",
      useFactory: () => new HttpOrderEventPublisher(
        fetch,
        process.env.NOTIFICATION_WORKER_URL ?? "http://localhost:3010",
      ),
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
