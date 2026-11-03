ALTER TABLE "OrderEventOutbox"
    ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "OrderEventOutbox_status_createdAt_idx";

CREATE INDEX "OrderEventOutbox_status_nextAttemptAt_createdAt_idx"
    ON "OrderEventOutbox"("status", "nextAttemptAt", "createdAt");
