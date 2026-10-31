import { Injectable } from "@nestjs/common";

import type { OrderCreatedEvent } from "./events.js";

export const NOTIFICATION_LEASE_MS = 30_000;

export type NotificationClaim =
  | { status: "claimed"; claimToken: string }
  | { status: "duplicate" }
  | { status: "processing" };

export interface NotificationStore {
  claim(eventId: string, now?: Date, leaseMilliseconds?: number): Promise<NotificationClaim>;
  markSent(eventId: string, claimToken: string): Promise<void>;
  markFailed(eventId: string, claimToken: string, reason: string): Promise<void>;
}

export interface NotificationSender {
  sendOrderCreated(event: OrderCreatedEvent): Promise<void>;
}

@Injectable()
export class NotificationWorker {
  public constructor(
    private readonly store: NotificationStore,
    private readonly sender: NotificationSender,
  ) {}

  public async handleOrderCreated(
    event: OrderCreatedEvent,
  ): Promise<"sent" | "duplicate" | "processing"> {
    const claim = await this.store.claim(event.eventId);
    if (claim.status !== "claimed") {
      return claim.status;
    }

    try {
      await this.sender.sendOrderCreated(event);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown notification error";
      await this.store.markFailed(event.eventId, claim.claimToken, reason);
      throw error;
    }

    await this.store.markSent(event.eventId, claim.claimToken);
    return "sent";
  }
}

@Injectable()
export class InMemoryNotificationStore implements NotificationStore {
  private readonly eventStatuses = new Map<
    string,
    {
      status: "PROCESSING" | "SENT" | "FAILED";
      attempts: number;
      claimToken: string | null;
      leaseExpiresAt: Date | null;
    }
  >();

  public async claim(
    eventId: string,
    now = new Date(),
    leaseMilliseconds = NOTIFICATION_LEASE_MS,
  ): Promise<NotificationClaim> {
    const existing = this.eventStatuses.get(eventId);
    if (existing?.status === "SENT") {
      return { status: "duplicate" };
    }
    if (
      existing?.status === "PROCESSING" &&
      existing.leaseExpiresAt !== null &&
      existing.leaseExpiresAt > now
    ) {
      return { status: "processing" };
    }

    const claimToken = crypto.randomUUID();
    this.eventStatuses.set(eventId, {
      status: "PROCESSING",
      attempts: (existing?.attempts ?? 0) + 1,
      claimToken,
      leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
    });
    return { status: "claimed", claimToken };
  }

  public async markSent(eventId: string, claimToken: string): Promise<void> {
    const current = this.eventStatuses.get(eventId);
    if (!current || current.status !== "PROCESSING" || current.claimToken !== claimToken) {
      throw new Error(`Notification claim lost for event: ${eventId}`);
    }
    current.status = "SENT";
    current.claimToken = null;
    current.leaseExpiresAt = null;
  }

  public async markFailed(eventId: string, claimToken: string, _reason: string): Promise<void> {
    const current = this.eventStatuses.get(eventId);
    if (!current || current.status !== "PROCESSING" || current.claimToken !== claimToken) {
      throw new Error(`Notification claim lost for event: ${eventId}`);
    }
    current.status = "FAILED";
    current.claimToken = null;
    current.leaseExpiresAt = null;
  }
}

@Injectable()
export class WebhookNotificationSender implements NotificationSender {
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly webhookUrl: string = process.env.NOTIFICATION_WEBHOOK_URL ?? "",
    private readonly webhookSecret: string = process.env.NOTIFICATION_WEBHOOK_SECRET ?? "",
  ) {}

  public async sendOrderCreated(event: OrderCreatedEvent): Promise<void> {
    const endpoint = this.webhookUrl || process.env.NOTIFICATION_WEBHOOK_URL || "";
    if (!endpoint) {
      throw new Error("NOTIFICATION_WEBHOOK_URL is not configured");
    }

    const response = await this.fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.webhookSecret ? { "x-notification-secret": this.webhookSecret } : {}),
      },
      body: JSON.stringify({
        eventType: event.eventType,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        orderId: event.aggregateId,
        customerId: event.payload.customerId,
        ...(event.payload.subtotalCop !== undefined ? { subtotalCop: event.payload.subtotalCop } : {}),
        ...(event.payload.deliveryFeeCop !== undefined ? { deliveryFeeCop: event.payload.deliveryFeeCop } : {}),
        totalCop: event.payload.totalCop,
        currency: event.payload.currency,
        items: event.payload.lines,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(
        `Notification webhook rejected OrderCreated.v1 (${response.status} ${response.statusText})`,
      );
    }
  }
}

@Injectable()
export class LoggingNotificationSender implements NotificationSender {
  public async sendOrderCreated(event: OrderCreatedEvent): Promise<void> {
    console.info("notification.order_created", {
      eventId: event.eventId,
      orderId: event.aggregateId,
      customerId: event.payload.customerId,
      totalCop: event.payload.totalCop,
      currency: event.payload.currency,
    });
  }
}
