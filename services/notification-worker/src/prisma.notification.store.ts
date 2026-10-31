import type { PrismaClient } from "../generated/notification-client/index.js";

import {
  NOTIFICATION_LEASE_MS,
  type NotificationClaim,
  type NotificationStore,
} from "./notification.worker.js";

export class PrismaNotificationStore implements NotificationStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async claim(
    eventId: string,
    now = new Date(),
    leaseMilliseconds = NOTIFICATION_LEASE_MS,
  ): Promise<NotificationClaim> {
    const claimToken = crypto.randomUUID();
    const created = await this.prisma.notificationDelivery.createMany({
      data: [{
        eventId,
        status: "PROCESSING",
        attempts: 1,
        claimToken,
        leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
      }],
      skipDuplicates: true,
    });
    if (created.count === 1) {
      return { status: "claimed", claimToken };
    }

    while (true) {
      const current = await this.prisma.notificationDelivery.findUnique({
        where: { eventId },
      });
      if (!current) {
        throw new Error(`Notification delivery disappeared while claiming event: ${eventId}`);
      }
      if (current.status === "SENT") {
        return { status: "duplicate" };
      }
      if (
        current.status === "PROCESSING" &&
        current.leaseExpiresAt !== null &&
        current.leaseExpiresAt > now
      ) {
        return { status: "processing" };
      }

      const replacementToken = crypto.randomUUID();
      const claimed = await this.prisma.notificationDelivery.updateMany({
        where: {
          eventId,
          attempts: current.attempts,
          OR: [
            { status: "FAILED" },
            { status: "PROCESSING", leaseExpiresAt: null },
            { status: "PROCESSING", leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          claimToken: replacementToken,
          leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
          lastError: null,
        },
      });
      if (claimed.count === 1) {
        return { status: "claimed", claimToken: replacementToken };
      }
    }
  }

  public async markSent(eventId: string, claimToken: string): Promise<void> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { eventId, status: "PROCESSING", claimToken },
      data: {
        status: "SENT",
        claimToken: null,
        leaseExpiresAt: null,
        lastError: null,
        processedAt: new Date(),
      },
    });
    if (result.count !== 1) {
      throw new Error(`Notification claim lost for event: ${eventId}`);
    }
  }

  public async markFailed(eventId: string, claimToken: string, reason: string): Promise<void> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { eventId, status: "PROCESSING", claimToken },
      data: {
        status: "FAILED",
        claimToken: null,
        leaseExpiresAt: null,
        lastError: reason.slice(0, 1000),
      },
    });
    if (result.count !== 1) {
      throw new Error(`Notification claim lost for event: ${eventId}`);
    }
  }
}
