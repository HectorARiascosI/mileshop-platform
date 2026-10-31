export type InventoryCommandType = "RESERVE" | "COMMIT" | "RELEASE";

export type InventoryCommand = {
  commandId: string;
  idempotencyKey: string;
  orderId: string;
  commandType: InventoryCommandType;
  payload: Record<string, unknown>;
};

export function createInventoryReleaseCommand(orderId: string): InventoryCommand {
  return {
    commandId: `${orderId}-release-inventory`,
    idempotencyKey: `${orderId}:RELEASE`,
    orderId,
    commandType: "RELEASE",
    payload: {},
  };
}

export type ClaimedInventoryCommand = {
  command: InventoryCommand;
  attemptCount: number;
  claimToken: string;
};

export type InventoryCommandFailureResult = {
  attemptCount: number;
  nextAttemptAt: Date | null;
};

export interface InventoryCommandRepository {
  claimPendingCommands(
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<ClaimedInventoryCommand[]>;
  markCommandCompleted(commandId: string, claimToken: string, completedAt: Date): Promise<void>;
  markCommandRejected(
    commandId: string,
    claimToken: string,
    reason: string,
    rejectedAt: Date,
    terminalOrderStatus?: "RESERVATION_FAILED" | "RESERVATION_EXPIRED",
  ): Promise<void>;
  markCommandFailed(
    commandId: string,
    claimToken: string,
    reason: string,
    failedAt: Date,
  ): Promise<InventoryCommandFailureResult>;
}

const MAX_ATTEMPTS = 8;

function retryDelayMs(attemptCount: number): number {
  return Math.min(5_000 * 2 ** (attemptCount - 1), 300_000);
}

type InMemoryCommandEntry = {
  command: InventoryCommand;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  attemptCount: number;
  nextAttemptAt: Date;
  claimToken: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
};

export class InMemoryInventoryCommandRepository implements InventoryCommandRepository {
  protected readonly commands = new Map<string, InMemoryCommandEntry>();

  public add(command: InventoryCommand): void {
    if (this.commands.has(command.commandId)) {
      throw new Error(`Duplicate inventory command: ${command.commandId}`);
    }
    this.commands.set(command.commandId, {
      command: structuredClone(command),
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: new Date(0),
      claimToken: null,
      leaseExpiresAt: null,
      lastError: null,
    });
  }

  public async claimPendingCommands(
    now: Date,
    leaseMilliseconds: number,
    limit: number,
  ): Promise<ClaimedInventoryCommand[]> {
    const claims: ClaimedInventoryCommand[] = [];
    for (const entry of this.commands.values()) {
      if (claims.length >= limit) {
        break;
      }

      const isPending = entry.status === "PENDING" && entry.nextAttemptAt <= now;
      const isExpired = entry.status === "PROCESSING" &&
        entry.leaseExpiresAt !== null &&
        entry.leaseExpiresAt <= now;
      if (!isPending && !isExpired) {
        continue;
      }
      if (entry.attemptCount >= MAX_ATTEMPTS) {
        entry.status = "FAILED";
        entry.claimToken = null;
        entry.leaseExpiresAt = null;
        continue;
      }

      const claimToken = crypto.randomUUID();
      entry.status = "PROCESSING";
      entry.attemptCount += 1;
      entry.claimToken = claimToken;
      entry.leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds);
      claims.push({
        command: structuredClone(entry.command),
        attemptCount: entry.attemptCount,
        claimToken,
      });
    }
    return claims;
  }

  public async markCommandCompleted(
    commandId: string,
    claimToken: string,
    _completedAt: Date,
  ): Promise<void> {
    const entry = this.commands.get(commandId);
    if (!entry || entry.status !== "PROCESSING" || entry.claimToken !== claimToken) {
      throw new Error(`Inventory command claim lost: ${commandId}`);
    }
    entry.status = "COMPLETED";
    entry.claimToken = null;
    entry.leaseExpiresAt = null;
    entry.lastError = null;
  }

  public async markCommandFailed(
    commandId: string,
    claimToken: string,
    reason: string,
    failedAt: Date,
  ): Promise<InventoryCommandFailureResult> {
    const entry = this.commands.get(commandId);
    if (!entry || entry.status !== "PROCESSING" || entry.claimToken !== claimToken) {
      throw new Error(`Inventory command claim lost: ${commandId}`);
    }

    const nextAttemptAt = entry.attemptCount >= MAX_ATTEMPTS
      ? null
      : new Date(failedAt.getTime() + retryDelayMs(entry.attemptCount));
    entry.status = nextAttemptAt ? "PENDING" : "FAILED";
    entry.claimToken = null;
    entry.leaseExpiresAt = null;
    entry.lastError = reason.slice(0, 1000);
    if (nextAttemptAt) {
      entry.nextAttemptAt = nextAttemptAt;
    }
    return { attemptCount: entry.attemptCount, nextAttemptAt };
  }

  public async markCommandRejected(
    commandId: string,
    claimToken: string,
    reason: string,
    _rejectedAt: Date,
    _terminalOrderStatus?: "RESERVATION_FAILED" | "RESERVATION_EXPIRED",
  ): Promise<void> {
    const entry = this.commands.get(commandId);
    if (!entry || entry.status !== "PROCESSING" || entry.claimToken !== claimToken) {
      throw new Error(`Inventory command claim lost: ${commandId}`);
    }
    entry.status = "FAILED";
    entry.claimToken = null;
    entry.leaseExpiresAt = null;
    entry.lastError = reason.slice(0, 1000);
  }
}
