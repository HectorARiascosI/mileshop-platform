import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import type { OrdersRepository } from "./orders.repository.js";

export const RESERVATION_EXPIRY_POLL_INTERVAL_MS = 30_000;
const EXPIRY_BATCH_SIZE = 25;

export interface InventoryCommandProcessor {
  processPendingCommands(): Promise<void>;
}

@Injectable()
export class OrderExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpiryWorker.name);
  private interval: NodeJS.Timeout | undefined;
  private isProcessing = false;

  public constructor(
    @Inject("ORDERS_REPOSITORY")
    private readonly repository: Pick<OrdersRepository, "expireDueOrders">,
    @Inject("INVENTORY_COMMAND_WORKER")
    private readonly inventoryCommandWorker?: InventoryCommandProcessor,
  ) {}

  public onModuleInit(): void {
    this.interval = setInterval(
      () => this.runScheduledCycle(),
      RESERVATION_EXPIRY_POLL_INTERVAL_MS,
    );
    this.runScheduledCycle();
  }

  public onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  public async processDueOrders(): Promise<number> {
    if (this.isProcessing) {
      return 0;
    }

    this.isProcessing = true;
    try {
      const expiredCount = await this.repository.expireDueOrders(
        new Date(),
        EXPIRY_BATCH_SIZE,
      );
      if (expiredCount > 0) {
        this.logger.log(`Expired ${expiredCount} unpaid reservation(s)`);
        if (this.inventoryCommandWorker) {
          void this.inventoryCommandWorker.processPendingCommands().catch((error: unknown) => {
            this.logger.error(
              "Immediate reservation-release attempt failed; durable inventory retries remain scheduled",
              error instanceof Error ? error.stack : undefined,
            );
          });
        } else {
          this.logger.error(
            "No inventory command worker is configured; durable reservation-release commands await polling recovery",
          );
        }
      }
      return expiredCount;
    } finally {
      this.isProcessing = false;
    }
  }

  private runScheduledCycle(): void {
    void this.processDueOrders().catch((error: unknown) => {
      this.logger.error(
        "Reservation expiry scan failed; the next scheduled scan will retry",
        error instanceof Error ? error.stack : undefined,
      );
    });
  }
}
