import { Module } from "@nestjs/common";

import { HttpCatalogReader } from "./catalog.reader.js";
import { OrdersController } from "./orders.controller.js";
import { OrderExpiryWorker } from "./order-expiry.worker.js";
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
import { PaymentEvidenceRetentionWorker } from "./payment-evidence/payment-evidence-retention.worker.js";
import { PaymentEvidenceService } from "./payment-evidence/payment-evidence.service.js";
import { createPaymentEvidenceStorage } from "./payment-evidence/payment-evidence.storage.js";
import { PrismaPaymentEvidenceRepository } from "./payment-evidence/prisma.payment-evidence.repository.js";
import { createPreviewProtectedFetch } from "./preview-protected-fetch.js";

const catalogFetch = createPreviewProtectedFetch(
  process.env.VERCEL_CATALOG_BYPASS_SECRET,
);
const notificationFetch = createPreviewProtectedFetch(
  process.env.VERCEL_NOTIFICATIONS_BYPASS_SECRET,
);

export function isPaymentEvidenceStorageConfigured(
  environment: NodeJS.ProcessEnv,
): boolean {
  return environment.NODE_ENV !== "production" ||
    Boolean(environment.PAYMENT_EVIDENCE_STORAGE?.trim());
}

const paymentEvidenceProviders = isPaymentEvidenceStorageConfigured(process.env)
  ? [
      {
        provide: "PAYMENT_EVIDENCE_REPOSITORY",
        useFactory: (prisma: PrismaService) => new PrismaPaymentEvidenceRepository(prisma),
        inject: [PrismaService],
      },
      {
        provide: "PAYMENT_EVIDENCE_STORAGE",
        useFactory: () => createPaymentEvidenceStorage(process.env),
      },
      {
        provide: "PAYMENT_EVIDENCE_SERVICE",
        useFactory: (
          repository: PrismaPaymentEvidenceRepository,
          storage: ReturnType<typeof createPaymentEvidenceStorage>,
        ) => new PaymentEvidenceService(repository, storage),
        inject: ["PAYMENT_EVIDENCE_REPOSITORY", "PAYMENT_EVIDENCE_STORAGE"],
      },
      {
        provide: PaymentEvidenceRetentionWorker,
        useFactory: (
          repository: PrismaPaymentEvidenceRepository,
          storage: ReturnType<typeof createPaymentEvidenceStorage>,
        ) =>
          new PaymentEvidenceRetentionWorker(
            repository,
            storage,
            process.env.PAYMENT_EVIDENCE_RETENTION_ENABLED === "true",
          ),
        inject: ["PAYMENT_EVIDENCE_REPOSITORY", "PAYMENT_EVIDENCE_STORAGE"],
      },
    ]
  : [];

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
    ...paymentEvidenceProviders,
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
        process.env.CATALOG_SERVICE_URL ?? "http://127.0.0.1:3020",
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
        process.env.CATALOG_SERVICE_URL ?? "http://127.0.0.1:3020",
        process.env.CATALOG_INVENTORY_COMMAND_TOKEN ?? "",
      ),
    },
    InventoryCommandWorker,
    OrderExpiryWorker,
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
