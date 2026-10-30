DO $$ BEGIN
  CREATE TYPE "OrderEventOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Order" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  "subtotalCop" INTEGER,
  "deliveryFeeCop" INTEGER,
  "totalCop" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "requestFingerprint" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "subtotalCop" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeCop" INTEGER;

UPDATE "Order"
SET
  "idempotencyKey" = COALESCE("idempotencyKey", 'legacy:' || "orderId"),
  "requestFingerprint" = COALESCE("requestFingerprint", 'legacy:' || "orderId"),
  "subtotalCop" = COALESCE("subtotalCop", "totalCop"),
  "deliveryFeeCop" = COALESCE("deliveryFeeCop", 0);

ALTER TABLE "Order" ALTER COLUMN "idempotencyKey" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "requestFingerprint" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "subtotalCop" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "deliveryFeeCop" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_orderId_key" ON "Order"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_customerId_idempotencyKey_key"
  ON "Order"("customerId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "Order_customerId_createdAt_idx"
  ON "Order"("customerId", "createdAt");

CREATE TABLE IF NOT EXISTS "OrderLine" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceCop" INTEGER NOT NULL,
  "orderId" TEXT NOT NULL,
  CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OrderLine_orderId_productId_idx"
  ON "OrderLine"("orderId", "productId");

CREATE TABLE IF NOT EXISTS "OrderEventOutbox" (
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OrderEventOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderEventOutbox_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX IF NOT EXISTS "OrderEventOutbox_status_nextAttemptAt_idx"
  ON "OrderEventOutbox"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "OrderEventOutbox_status_leaseExpiresAt_idx"
  ON "OrderEventOutbox"("status", "leaseExpiresAt");
