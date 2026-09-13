export type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export type OrderLineInput = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type CreateOrderCommand = {
  customerId: string;
  lines: OrderLineInput[];
};

export type CreateOrderInput = CreateOrderCommand;

export type OrderLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type Order = {
  id: string;
  orderId: string;
  customerId: string;
  totalCop: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  lines: OrderLine[];
};
