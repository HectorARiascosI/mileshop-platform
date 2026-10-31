CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestLines" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryReservationLine" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCop" INTEGER NOT NULL,

    CONSTRAINT "InventoryReservationLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryReservation_orderId_key"
    ON "InventoryReservation"("orderId");
CREATE INDEX "InventoryReservation_status_createdAt_idx"
    ON "InventoryReservation"("status", "createdAt");
CREATE UNIQUE INDEX "InventoryReservationLine_reservationId_productId_key"
    ON "InventoryReservationLine"("reservationId", "productId");
CREATE UNIQUE INDEX "InventoryMovement_reservationId_productId_movementType_key"
    ON "InventoryMovement"("reservationId", "productId", "movementType");
CREATE INDEX "InventoryMovement_productId_createdAt_idx"
    ON "InventoryMovement"("productId", "createdAt");

ALTER TABLE "InventoryReservationLine"
    ADD CONSTRAINT "InventoryReservationLine_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
