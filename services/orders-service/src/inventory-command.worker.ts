import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import type {
  ClaimedInventoryCommand,
  InventoryCommand,
  InventoryCommandRepository,
} from "./inventory-command.repository.js";

export interface InventoryCommandDispatcher {
  dispatch(command: InventoryCommand): Promise<void>;
}

export class InventoryReservationRejectedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InventoryReservationRejectedError";
  }
}

export class InventoryReservationExpiredError extends InventoryReservationRejectedError {
  public constructor() {
    super("Inventory reservation expired before it could be created");
    this.name = "InventoryReservationExpiredError";
  }
}

function reservationExpiresAt(command: InventoryCommand): Date | null {
  const value = command.payload.expiresAt;
  if (command.commandType !== "RESERVE" || typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

const POLL_INTERVAL_MS = 5_000;
const CLAIM_LEASE_MS = 30_000;
const CLAIM_BATCH_SIZE = 25;

@Injectable()
export class HttpInventoryCommandDispatcher implements InventoryCommandDispatcher {
  public constructor(
    private readonly fetcher: typeof fetch,
    private readonly catalogServiceUrl: string,
    private readonly authToken: string,
  ) {}

  public async dispatch(command: InventoryCommand): Promise<void> {
    if (!this.authToken) {
      throw new Error("CATALOG_INVENTORY_COMMAND_TOKEN is not configured");
    }
    const endpoint = {
      RESERVE: "/internal/inventory/reservations",
      COMMIT: "/internal/inventory/reservations/commit",
      RELEASE: "/internal/inventory/reservations/release",
    }[command.commandType];
    const response = await this.fetcher(
      `${this.catalogServiceUrl}${endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": command.orderId,
          authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          ...command.payload,
          commandId: command.commandId,
          orderId: command.orderId,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (
      command.commandType === "RESERVE" &&
      response.status === 400
    ) {
      const expiresAt = reservationExpiresAt(command);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new InventoryReservationExpiredError();
      }
      throw new InventoryReservationRejectedError(
        "Catalog permanently rejected the inventory reservation with HTTP 400",
      );
    }
    if (
      command.commandType === "RESERVE" &&
      (response.status === 409 || response.status === 404)
    ) {
      throw new InventoryReservationRejectedError(
        `Catalog rejected the reservation with HTTP ${response.status}`,
      );
    }
    if (!response.ok) {
      throw new Error(`Catalog inventory command failed with HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("data" in body) ||
      typeof body.data !== "object" ||
      body.data === null ||
      !("status" in body.data) ||
      body.data.status !== {
        RESERVE: "ACTIVE",
        COMMIT: "COMMITTED",
        RELEASE: "RELEASED",
      }[command.commandType]
    ) {
      throw new Error("Catalog returned an invalid inventory command result");
    }
  }
}

@Injectable()
export class InventoryCommandWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryCommandWorker.name);
  private interval: NodeJS.Timeout | undefined;
  private isProcessing = false;

  public constructor(
    @Inject("INVENTORY_COMMAND_REPOSITORY")
    private readonly repository: InventoryCommandRepository,
    @Inject("INVENTORY_COMMAND_DISPATCHER")
    private readonly dispatcher: InventoryCommandDispatcher,
  ) {}

  public onModuleInit(): void {
    this.interval = setInterval(() => {
      void this.processPendingCommands().catch((error: unknown) => {
        this.logger.error("Inventory command polling failed", error);
      });
    }, POLL_INTERVAL_MS);
    void this.processPendingCommands().catch((error: unknown) => {
      this.logger.error("Initial inventory command recovery failed", error);
    });
  }

  public onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  public async processPendingCommands(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const claims = await this.repository.claimPendingCommands(
        new Date(),
        CLAIM_LEASE_MS,
        CLAIM_BATCH_SIZE,
      );
      const results = await Promise.allSettled(
        claims.map((claim) => this.processClaim(claim)),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          this.logger.error("Inventory command state update failed", result.reason);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processClaim(claim: ClaimedInventoryCommand): Promise<void> {
    try {
      const expiresAt = reservationExpiresAt(claim.command);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new InventoryReservationExpiredError();
      }
      await this.dispatcher.dispatch(claim.command);
      await this.repository.markCommandCompleted(
        claim.command.commandId,
        claim.claimToken,
        new Date(),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof InventoryReservationRejectedError) {
        const terminalOrderStatus =
          error instanceof InventoryReservationExpiredError
            ? "RESERVATION_EXPIRED"
            : "RESERVATION_FAILED";
        await this.repository.markCommandRejected(
          claim.command.commandId,
          claim.claimToken,
          reason,
          new Date(),
          terminalOrderStatus,
        );
        this.logger.warn(
          `Order ${claim.command.orderId} could not reserve inventory: ${reason}`,
        );
        return;
      }
      const result = await this.repository.markCommandFailed(
        claim.command.commandId,
        claim.claimToken,
        reason,
        new Date(),
      );
      if (result.nextAttemptAt) {
        this.logger.warn(
          `Inventory command ${claim.command.commandId} failed on attempt ${result.attemptCount}; retry scheduled: ${reason}`,
        );
      } else {
        this.logger.error(
          `Inventory command ${claim.command.commandId} exhausted retries and requires operator recovery: ${reason}`,
        );
      }
    }
  }
}
