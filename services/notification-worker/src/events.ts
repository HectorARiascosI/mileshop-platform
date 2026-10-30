import { z } from "zod";

export const orderCreatedSchema = z.object({
  eventType: z.literal("OrderCreated.v1"),
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  aggregateId: z.string().min(1),
  payload: z.object({
    customerId: z.string().min(1),
    subtotalCop: z.number().int().nonnegative().refine(Number.isSafeInteger),
    deliveryFeeCop: z.number().int().nonnegative().refine(Number.isSafeInteger),
    totalCop: z.number().int().nonnegative().refine(Number.isSafeInteger),
    currency: z.literal("COP"),
    lines: z.array(
      z.object({
        productId: z.string().min(1),
        sku: z.string().min(1),
        name: z.string().min(1),
        quantity: z.number().int().positive().refine(Number.isSafeInteger),
        unitPriceCop: z.number().int().nonnegative().refine(Number.isSafeInteger),
      }),
    ),
  }),
}).superRefine((event, context) => {
  const lineSubtotalCop = event.payload.lines.reduce(
    (subtotal, line) => subtotal + line.unitPriceCop * line.quantity,
    0,
  );
  if (!Number.isSafeInteger(lineSubtotalCop) || lineSubtotalCop !== event.payload.subtotalCop) {
    context.addIssue({
      code: "custom",
      message: "OrderCreated.v1 subtotal does not match its lines",
      path: ["payload", "subtotalCop"],
    });
  }
  const expectedTotalCop = event.payload.subtotalCop + event.payload.deliveryFeeCop;
  if (!Number.isSafeInteger(expectedTotalCop) || event.payload.totalCop !== expectedTotalCop) {
    context.addIssue({
      code: "custom",
      message: "OrderCreated.v1 total does not match subtotal and delivery fee",
      path: ["payload", "totalCop"],
    });
  }
});

export type OrderCreatedEvent = z.infer<typeof orderCreatedSchema>;
