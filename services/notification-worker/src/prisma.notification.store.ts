import { PrismaClient } from "../generated/notification-client/index.js";

import type {
  NotificationStore,
  ProcessEventResult,
} from "./notification.worker.js";

export class PrismaNotificationStore implements NotificationStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async claim(eventId: string): Promise<ProcessEventResult> {
    try {
      await this.prisma.notificationDelivery.create({
        data: { eventId },
      });
      return "claimed";
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.prisma.notificationDelivery.findUniqueOrThrow({
          where: { eventId },
        });
        if (existing.status === "FAILED") {
          await this.prisma.notificationDelivery.update({
            where: { eventId },
            data: {
              status: "PROCESSING",
              attempts: { increment: 1 },
              lastError: null,
            },
          });
          return "claimed";
        }
        return "duplicate";
      }
      throw error;
    }
  }

  public async markSent(eventId: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { eventId },
      data: { status: "SENT", processedAt: new Date() },
    });
  }

  public async markFailed(eventId: string, reason: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { eventId },
      data: { status: "FAILED", lastError: reason.slice(0, 1000) },
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
  }
}
