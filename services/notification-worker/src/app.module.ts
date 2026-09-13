import { Module } from "@nestjs/common";
import { PrismaClient } from "../generated/notification-client/index.js";

import {
  InMemoryNotificationStore,
  LoggingNotificationSender,
  NotificationWorker,
} from "./notification.worker.js";
import { NotificationsController } from "./notifications.controller.js";
import { PrismaNotificationStore } from "./prisma.notification.store.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [NotificationsController],
  providers: [
    InMemoryNotificationStore,
    LoggingNotificationSender,
    PrismaService,
    {
      provide: "PRISMA_CLIENT",
      inject: [PrismaService],
      useFactory: (prisma: PrismaService): PrismaClient | null =>
        process.env.DATABASE_URL ? prisma : null,
    },
    {
      provide: "NOTIFICATION_STORE",
      inject: ["PRISMA_CLIENT", InMemoryNotificationStore],
      useFactory: (
        prisma: PrismaClient | null,
        inMemoryStore: InMemoryNotificationStore,
      ) => (prisma ? new PrismaNotificationStore(prisma) : inMemoryStore),
    },
    {
      provide: "NOTIFICATION_SENDER",
      useExisting: LoggingNotificationSender,
    },
    {
      provide: "NOTIFICATION_WORKER",
      inject: ["NOTIFICATION_STORE", "NOTIFICATION_SENDER"],
      useFactory: (store: InMemoryNotificationStore, sender: LoggingNotificationSender) =>
        new NotificationWorker(store, sender),
    },
  ],
})
export class AppModule {}
