import { z } from "zod";

export const orderLineSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCop: z.number().int().nonnegative(),
});

export const createOrderSchema = z.object({
  customerId: z.string().min(1),
  lines: z.array(orderLineSchema).min(1),
});

export type CreateOrderCommand = z.infer<typeof createOrderSchema>;
