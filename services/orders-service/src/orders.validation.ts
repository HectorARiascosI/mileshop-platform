import { z } from "zod";

export const orderLineSchema = z.object({
  productId: z.string().min(1).max(128),
  sku: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  quantity: z.number().int().positive().refine(Number.isSafeInteger),
  unitPriceCop: z.number().int().nonnegative().refine(Number.isSafeInteger),
});

export const createOrderSchema = z.object({
  customerId: z.string().min(1).max(128),
  idempotencyKey: z.string().uuid(),
  lines: z.array(orderLineSchema).min(1).max(100),
});

export type CreateOrderCommand = z.infer<typeof createOrderSchema>;

export class InvalidOrderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidOrderError";
  }
}

export class OrderConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OrderConflictError";
  }
}
