CREATE TYPE "CustomerRole" AS ENUM ('CUSTOMER', 'STORE_ADMIN');

ALTER TABLE "Customer"
ADD COLUMN "role" "CustomerRole" NOT NULL DEFAULT 'CUSTOMER';

CREATE TABLE "OwnerBootstrap" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerBootstrap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerBootstrap_customerId_key"
ON "OwnerBootstrap"("customerId");

ALTER TABLE "OwnerBootstrap"
ADD CONSTRAINT "OwnerBootstrap_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
