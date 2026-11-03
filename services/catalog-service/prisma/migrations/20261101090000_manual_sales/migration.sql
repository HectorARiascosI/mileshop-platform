CREATE TABLE "ManualSale" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "adminCustomerId" TEXT NOT NULL,
    "requestLines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualSale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManualSaleLine" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCop" INTEGER NOT NULL,

    CONSTRAINT "ManualSaleLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualSale_idempotencyKey_key"
    ON "ManualSale"("idempotencyKey");
CREATE INDEX "ManualSale_createdAt_idx"
    ON "ManualSale"("createdAt");
CREATE UNIQUE INDEX "ManualSaleLine_saleId_productId_key"
    ON "ManualSaleLine"("saleId", "productId");

ALTER TABLE "ManualSaleLine"
    ADD CONSTRAINT "ManualSaleLine_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "ManualSale"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManualSaleLine"
    ADD CONSTRAINT "ManualSaleLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
