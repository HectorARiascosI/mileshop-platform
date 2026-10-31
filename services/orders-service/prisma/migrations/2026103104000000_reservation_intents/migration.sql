CREATE TABLE "ReservationIntent" (
    "intentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lines" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationIntent_pkey" PRIMARY KEY ("intentId")
);

CREATE UNIQUE INDEX "ReservationIntent_orderId_key" ON "ReservationIntent"("orderId");
CREATE UNIQUE INDEX "ReservationIntent_idempotencyKey_key" ON "ReservationIntent"("idempotencyKey");
CREATE INDEX "ReservationIntent_status_nextAttemptAt_createdAt_idx"
ON "ReservationIntent"("status", "nextAttemptAt", "createdAt");
