CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageFileId" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProductImage" ("id", "productId", "imageUrl", "imageFileId", "position")
SELECT 'image_' || md5("id"), "id", "imageUrl", "imageFileId", 0
FROM "Product"
WHERE "imageUrl" IS NOT NULL;

CREATE UNIQUE INDEX "ProductImage_productId_position_key"
ON "ProductImage"("productId", "position");
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

ALTER TABLE "ProductImage"
ADD CONSTRAINT "ProductImage_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
