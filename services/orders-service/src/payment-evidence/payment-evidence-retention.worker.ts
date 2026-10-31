import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import type { PaymentEvidenceRepository } from "./payment-evidence.repository.js";
import type { PaymentEvidenceStorage } from "./payment-evidence.storage.js";

export const PAYMENT_EVIDENCE_RETENTION_POLL_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 25;
const CLEANUP_LEASE_MS = 60 * 1000;

@Injectable()
export class PaymentEvidenceRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentEvidenceRetentionWorker.name);
  private interval: NodeJS.Timeout | undefined;
  private isProcessing = false;

  public constructor(
    @Inject("PAYMENT_EVIDENCE_REPOSITORY")
    private readonly repository: Pick<
      PaymentEvidenceRepository,
      "claimExpiredForCleanup" | "markEvidenceDeleted"
    >,
    @Inject("PAYMENT_EVIDENCE_STORAGE")
    private readonly storage: PaymentEvidenceStorage,
    private readonly enabled = false,
  ) {}

  public onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        "Payment evidence retention cleanup is disabled; enable it only after legal/accounting approval",
      );
      return;
    }
    this.interval = setInterval(
      () => this.runScheduledCycle(),
      PAYMENT_EVIDENCE_RETENTION_POLL_INTERVAL_MS,
    );
    this.runScheduledCycle();
  }

  public onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  public async cleanupExpiredEvidence(): Promise<number> {
    if (!this.enabled || this.isProcessing) {
      return 0;
    }

    this.isProcessing = true;
    try {
      const claims = await this.repository.claimExpiredForCleanup(
        new Date(),
        CLEANUP_BATCH_SIZE,
        CLEANUP_LEASE_MS,
      );
      let deletedCount = 0;
      for (const claim of claims) {
        try {
          await this.storage.delete(claim.storageKey);
          const markedDeleted = await this.repository.markEvidenceDeleted(
            claim.id,
            claim.claimToken,
            new Date(),
          );
          if (!markedDeleted) {
            throw new Error(`Payment evidence cleanup claim was lost: ${claim.id}`);
          }
          deletedCount += 1;
        } catch (error) {
          this.logger.error(
            `Payment evidence cleanup failed for record ${claim.id}; its lease will allow a safe retry`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
      if (deletedCount > 0) {
        this.logger.log(`Deleted ${deletedCount} expired payment evidence file(s)`);
      }
      return deletedCount;
    } finally {
      this.isProcessing = false;
    }
  }

  private runScheduledCycle(): void {
    void this.cleanupExpiredEvidence().catch((error: unknown) => {
      this.logger.error(
        "Payment evidence retention scan failed; the next scheduled scan will retry",
        error instanceof Error ? error.stack : undefined,
      );
    });
  }
}
