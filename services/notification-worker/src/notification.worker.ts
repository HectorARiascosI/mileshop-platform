import { Injectable } from "@nestjs/common";

import type { OrderCreatedEvent } from "./events.js";

export interface NotificationStore {
  claim(eventId: string): Promise<ProcessEventResult>;
  markSent(eventId: string): Promise<void>;
  markFailed(eventId: string, reason: string): Promise<void>;
}

export type ProcessEventResult = "claimed" | "duplicate";

export interface NotificationSender {
  sendOrderCreated(event: OrderCreatedEvent): Promise<void>;
}

@Injectable()
export class NotificationWorker {
  public constructor(
    private readonly store: NotificationStore,
    private readonly sender: NotificationSender,
  ) {}

  public async handleOrderCreated(event: OrderCreatedEvent): Promise<"sent" | "duplicate"> {
    if ((await this.store.claim(event.eventId)) === "duplicate") {
      return "duplicate";
    }

    try {
      await this.sender.sendOrderCreated(event);
      await this.store.markSent(event.eventId);
      return "sent";
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown notification error";
      await this.store.markFailed(event.eventId, reason);
      throw error;
    }
  }
}

@Injectable()
export class InMemoryNotificationStore implements NotificationStore {
  private readonly eventStatuses = new Map<string, "PROCESSING" | "SENT" | "FAILED">();

  public async claim(eventId: string): Promise<ProcessEventResult> {
    const status = this.eventStatuses.get(eventId);
    if (status === "SENT" || status === "PROCESSING") {
      return "duplicate";
    }
    this.eventStatuses.set(eventId, "PROCESSING");
    return "claimed";
  }

  public async markSent(eventId: string): Promise<void> {
    this.eventStatuses.set(eventId, "SENT");
  }

  public async markFailed(eventId: string, _reason: string): Promise<void> {
    this.eventStatuses.set(eventId, "FAILED");
  }
}

@Injectable()
export class LoggingNotificationSender implements NotificationSender {
  public async sendOrderCreated(event: OrderCreatedEvent): Promise<void> {
    console.info("notification.order_created", {
      eventId: event.eventId,
      orderId: event.aggregateId,
      customerId: event.payload.customerId,
    });
  }
}
