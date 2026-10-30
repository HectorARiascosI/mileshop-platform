DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('PROCESSING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PROCESSING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "claimToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "claimToken" TEXT;
ALTER TABLE "NotificationDelivery" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

UPDATE "NotificationDelivery"
SET "status" = 'FAILED'
WHERE "status" = 'PROCESSING' AND "leaseExpiresAt" IS NULL;

DROP INDEX IF EXISTS "NotificationDelivery_status_createdAt_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDelivery_eventId_key"
  ON "NotificationDelivery"("eventId");
CREATE INDEX IF NOT EXISTS "NotificationDelivery_status_leaseExpiresAt_idx"
  ON "NotificationDelivery"("status", "leaseExpiresAt");
