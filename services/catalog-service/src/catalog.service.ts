import { Injectable } from "@nestjs/common";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

export interface CatalogStore {
  listActiveProducts(): Promise<Product[]>;
  reserveProducts(orderId: string, lines: ReservationRequestLine[]): Promise<InventoryReservation>;
}

export type ReservationRequestLine = {
  productId: string;
  quantity: number;
};

export type ReservedProductLine = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

export type InventoryReservation = {
  orderId: string;
  status: "RESERVED";
  reservedAt: string;
  lines: ReservedProductLine[];
};

export function normalizeReservationLines(
  lines: ReservationRequestLine[],
): ReservationRequestLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new InventoryConflictError("Reservation must include at least one product");
  }

  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (
      typeof line.productId !== "string" ||
      line.productId.length === 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new InventoryConflictError("Reservation line is invalid");
    }

    const quantity = (quantities.get(line.productId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity)) {
      throw new InventoryConflictError("Reservation quantity is invalid");
    }
    quantities.set(line.productId, quantity);
  }

  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
}

export class InventoryConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InventoryConflictError";
  }
}

export class ReservationIdempotencyConflictError extends Error {
  public constructor() {
    super("Reservation idempotency key was reused with different product quantities");
    this.name = "ReservationIdempotencyConflictError";
  }
}

@Injectable()
export class InMemoryCatalogStore implements CatalogStore {
  private readonly products: Product[] = [
    {
      id: "prod-mug-001",
      sku: "MILE-MUG-001",
      name: "Taza de cerámica",
      description: "Una taza sencilla para empezar bien el día.",
      priceCop: 28000,
      stock: 24,
    },
    {
      id: "prod-bag-001",
      sku: "MILE-BAG-001",
      name: "Bolso de lona",
      description: "Ligero, resistente y listo para acompañarte.",
      priceCop: 76000,
      stock: 12,
    },
    {
      id: "prod-note-001",
      sku: "MILE-NOTE-001",
      name: "Cuaderno de notas",
      description: "Papel de calidad para ideas y planes.",
      priceCop: 19000,
      stock: 38,
    },
  ];
  private readonly reservations = new Map<string, {
    requestLines: ReservationRequestLine[];
    result: InventoryReservation;
  }>();
  private operationTail: Promise<void> = Promise.resolve();

  public async listActiveProducts(): Promise<Product[]> {
    return this.products
      .map((product) => ({ ...product }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async reserveProducts(
    orderId: string,
    lines: ReservationRequestLine[],
  ): Promise<InventoryReservation> {
    return this.withExclusiveLock(async () => {
      const requestLines = normalizeReservationLines(lines);
      const existing = this.reservations.get(orderId);
      if (existing) {
        if (JSON.stringify(existing.requestLines) !== JSON.stringify(requestLines)) {
          throw new ReservationIdempotencyConflictError();
        }
        return structuredClone(existing.result);
      }

      const products = requestLines.map((line) => {
        const product = this.products.find((candidate) => candidate.id === line.productId);
        if (!product) {
          throw new InventoryConflictError(`Product is not available: ${line.productId}`);
        }
        if (product.stock < line.quantity) {
          throw new InventoryConflictError(`Insufficient stock: ${product.sku}`);
        }
        return { product, quantity: line.quantity };
      });

      const reservedAt = new Date().toISOString();
      const result: InventoryReservation = {
        orderId,
        status: "RESERVED",
        reservedAt,
        lines: products.map(({ product, quantity }) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
          unitPriceCop: product.priceCop,
        })),
      };

      for (const { product, quantity } of products) {
        product.stock -= quantity;
      }
      this.reservations.set(orderId, {
        requestLines,
        result: structuredClone(result),
      });
      return result;
    });
  }

  private async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

@Injectable()
export class CatalogService {
  public constructor(private readonly store: CatalogStore) {}

  public async listProducts(): Promise<Product[]> {
    return this.store.listActiveProducts();
  }

  public async reserveProducts(
    orderId: string,
    lines: ReservationRequestLine[],
  ): Promise<InventoryReservation> {
    if (!orderId.trim()) {
      throw new InventoryConflictError("Order id is required");
    }
    return this.store.reserveProducts(orderId, lines);
  }
}
