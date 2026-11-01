ALTER TABLE "Product"
    ADD COLUMN "imageUrl" TEXT;

CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "adminCustomerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "StockReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockReceipt_idempotencyKey_key"
    ON "StockReceipt"("idempotencyKey");
CREATE INDEX "StockReceipt_createdAt_idx"
    ON "StockReceipt"("createdAt");
CREATE INDEX "StockReceipt_adminCustomerId_createdAt_idx"
    ON "StockReceipt"("adminCustomerId", "createdAt");
CREATE UNIQUE INDEX "StockReceiptLine_receiptId_productId_key"
    ON "StockReceiptLine"("receiptId", "productId");

ALTER TABLE "StockReceiptLine"
    ADD CONSTRAINT "StockReceiptLine_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReceiptLine"
    ADD CONSTRAINT "StockReceiptLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
