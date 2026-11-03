ALTER TABLE "Order"
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "subtotalCop" INTEGER,
    ADD COLUMN "deliveryFeeCop" INTEGER;

UPDATE "Order" AS orders
SET
    "idempotencyKey" = 'legacy-' || orders."orderId",
    "subtotalCop" = COALESCE(lines."subtotalCop", orders."totalCop"),
    "deliveryFeeCop" = orders."totalCop" - COALESCE(lines."subtotalCop", orders."totalCop")
FROM (
    SELECT "orderId", SUM("quantity" * "unitPriceCop")::INTEGER AS "subtotalCop"
    FROM "OrderLine"
    GROUP BY "orderId"
) AS lines
WHERE lines."orderId" = orders."id";

UPDATE "Order"
SET
    "idempotencyKey" = 'legacy-' || "orderId",
    "subtotalCop" = "totalCop",
    "deliveryFeeCop" = 0
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "Order"
    ALTER COLUMN "idempotencyKey" SET NOT NULL,
    ALTER COLUMN "subtotalCop" SET NOT NULL,
    ALTER COLUMN "deliveryFeeCop" SET NOT NULL;

CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
