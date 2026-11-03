CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Promotion"
ADD CONSTRAINT "Promotion_dates_check" CHECK ("endsAt" > "startsAt");

CREATE TABLE "PromotionProduct" (
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,

    CONSTRAINT "PromotionProduct_pkey" PRIMARY KEY ("promotionId", "productId")
);

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_discountPercent_check"
CHECK ("discountPercent" BETWEEN 1 AND 90);

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "linkUrl" TEXT,
    "linkLabel" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Announcement"
ADD CONSTRAINT "Announcement_dates_check" CHECK ("endsAt" > "startsAt");

CREATE INDEX "Promotion_isActive_startsAt_endsAt_idx"
ON "Promotion"("isActive", "startsAt", "endsAt");
CREATE INDEX "PromotionProduct_productId_idx" ON "PromotionProduct"("productId");
CREATE INDEX "Announcement_isActive_startsAt_endsAt_idx"
ON "Announcement"("isActive", "startsAt", "endsAt");

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_promotionId_fkey"
FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PromotionProduct"
ADD CONSTRAINT "PromotionProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
