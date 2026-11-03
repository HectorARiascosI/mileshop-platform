ALTER TABLE "Order"
ADD COLUMN "cancelResolvedByCustomerId" TEXT,
ADD COLUMN "cancelResolutionNote" TEXT,
ADD COLUMN "cancelPaymentCaptured" BOOLEAN,
ADD COLUMN "externalRefundRecordedByCustomerId" TEXT,
ADD COLUMN "externalRefundReference" TEXT;

CREATE INDEX "Order_status_cancelResolvedAt_cancelRequestedAt_idx"
ON "Order"("status", "cancelResolvedAt", "cancelRequestedAt");
