ALTER TABLE "PaymentEvidence"
ALTER COLUMN "storageKey" DROP NOT NULL,
ALTER COLUMN "originalFileName" DROP NOT NULL,
ALTER COLUMN "contentType" DROP NOT NULL,
ADD COLUMN "cleanupClaimToken" TEXT,
ADD COLUMN "cleanupLeaseExpiresAt" TIMESTAMP(3);

DROP INDEX "PaymentEvidence_retentionUntil_legalHold_idx";
CREATE INDEX "PaymentEvidence_retentionUntil_legalHold_deletedAt_idx"
ON "PaymentEvidence"("retentionUntil", "legalHold", "deletedAt");

CREATE INDEX "PaymentEvidence_cleanupLeaseExpiresAt_idx"
ON "PaymentEvidence"("cleanupLeaseExpiresAt");

CREATE TABLE "PaymentEvidenceLegalHold" (
    "id" TEXT NOT NULL,
    "paymentEvidenceId" TEXT NOT NULL,
    "setByCustomerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByCustomerId" TEXT,
    "releaseReason" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentEvidenceLegalHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentEvidenceLegalHold_paymentEvidenceId_setAt_idx"
ON "PaymentEvidenceLegalHold"("paymentEvidenceId", "setAt");

ALTER TABLE "PaymentEvidenceLegalHold"
ADD CONSTRAINT "PaymentEvidenceLegalHold_paymentEvidenceId_fkey"
FOREIGN KEY ("paymentEvidenceId") REFERENCES "PaymentEvidence"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "PaymentEvidence" AS evidence
SET "retentionUntil" = orders."updatedAt" + INTERVAL '12 months'
FROM "Order" AS orders
WHERE evidence."orderId" = orders."orderId"
  AND evidence."retentionUntil" IS NULL
  AND orders."status" IN ('CONFIRMED', 'CANCELLED', 'RESERVATION_EXPIRED', 'RESERVATION_FAILED');
