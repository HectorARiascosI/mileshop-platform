import { z } from "zod";

export const orderCreatedSchema = z.object({
  eventType: z.literal("OrderCreated.v1"),
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  aggregateId: z.string().min(1),
  payload: z.object({
    customerId: z.string().min(1),
    totalCop: z.number().int().nonnegative(),
    currency: z.literal("COP"),
    lines: z.array(
      z.object({
        productId: z.string().min(1),
        sku: z.string().min(1),
        name: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPriceCop: z.number().int().nonnegative(),
      }),
    ),
  }),
});

export type OrderCreatedEvent = z.infer<typeof orderCreatedSchema>;
