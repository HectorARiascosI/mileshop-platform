import { Module } from "@nestjs/common";
import { PrismaClient } from "../generated/notification-client/index.js";

import {
  InMemoryNotificationStore,
  LoggingNotificationSender,
  NotificationWorker,
  type NotificationSender,
  WebhookNotificationSender,
} from "./notification.worker.js";
import { NotificationsController } from "./notifications.controller.js";
import { PrismaNotificationStore } from "./prisma.notification.store.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [NotificationsController],
  providers: [
    InMemoryNotificationStore,
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
      useFactory: (): NotificationSender => {
        const mode = process.env.NOTIFICATION_SENDER_MODE ?? "webhook";
        if (mode === "log") {
          return new LoggingNotificationSender();
        }
        if (mode !== "webhook") {
          throw new Error(`Unsupported NOTIFICATION_SENDER_MODE: ${mode}`);
        }
        if (!process.env.NOTIFICATION_WEBHOOK_URL) {
          throw new Error("NOTIFICATION_WEBHOOK_URL is required in webhook mode");
        }
        return new WebhookNotificationSender();
      },
    },
    {
      provide: "NOTIFICATION_WORKER",
      inject: ["NOTIFICATION_STORE", "NOTIFICATION_SENDER"],
      useFactory: (store: InMemoryNotificationStore, sender: NotificationSender) =>
        new NotificationWorker(store, sender),
    },
  ],
})
export class AppModule {}
