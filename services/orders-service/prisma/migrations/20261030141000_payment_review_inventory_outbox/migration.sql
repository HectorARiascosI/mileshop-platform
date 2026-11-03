CREATE TYPE "PaymentDecisionType" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "InventoryCommandType" AS ENUM ('RESERVE', 'COMMIT', 'RELEASE');
CREATE TYPE "InventoryCommandStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "Order"
ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN "cancelResolvedAt" TIMESTAMP(3),
ADD COLUMN "cancelResolution" TEXT,
ADD COLUMN "externalRefundHandledAt" TIMESTAMP(3);

CREATE TABLE "PaymentEvidence" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "transactionReference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentDecision" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "decision" "PaymentDecisionType" NOT NULL,
    "adminCustomerId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "PaymentDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryCommandOutbox" (
    "commandId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "commandType" "InventoryCommandType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "InventoryCommandStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCommandOutbox_pkey" PRIMARY KEY ("commandId")
);

CREATE UNIQUE INDEX "PaymentEvidence_orderId_key" ON "PaymentEvidence"("orderId");
CREATE UNIQUE INDEX "PaymentEvidence_storageKey_key" ON "PaymentEvidence"("storageKey");
CREATE INDEX "PaymentEvidence_retentionUntil_legalHold_idx" ON "PaymentEvidence"("retentionUntil", "legalHold");
CREATE UNIQUE INDEX "PaymentDecision_orderId_key" ON "PaymentDecision"("orderId");
CREATE INDEX "PaymentDecision_adminCustomerId_decidedAt_idx" ON "PaymentDecision"("adminCustomerId", "decidedAt");
CREATE UNIQUE INDEX "InventoryCommandOutbox_idempotencyKey_key" ON "InventoryCommandOutbox"("idempotencyKey");
CREATE INDEX "InventoryCommandOutbox_status_nextAttemptAt_idx" ON "InventoryCommandOutbox"("status", "nextAttemptAt");
CREATE INDEX "InventoryCommandOutbox_status_leaseExpiresAt_idx" ON "InventoryCommandOutbox"("status", "leaseExpiresAt");
CREATE INDEX "InventoryCommandOutbox_orderId_createdAt_idx" ON "InventoryCommandOutbox"("orderId", "createdAt");

ALTER TABLE "PaymentEvidence"
ADD CONSTRAINT "PaymentEvidence_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentDecision"
ADD CONSTRAINT "PaymentDecision_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryCommandOutbox"
ADD CONSTRAINT "InventoryCommandOutbox_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;
