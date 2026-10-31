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
  reserveInventory(orderId: string, lines: ReservationRequestLine[], expiresAt: Date): Promise<InventoryReservation>;
  commitInventory(orderId: string): Promise<InventoryReservation>;
  releaseInventory(orderId: string): Promise<InventoryReservation>;
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
  status: "RESERVED" | "ACTIVE" | "COMMITTED" | "RELEASED";
  reservedAt: string;
  lines: ReservedProductLine[];
};

export function normalizeReservationLines(
  lines: ReservationRequestLine[],
): ReservationRequestLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw Object.assign(new Error("Reservation must include at least one product"), { code: "INVALID_COMMAND" });
  }

  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (
      typeof line.productId !== "string" ||
      line.productId.length === 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw Object.assign(new Error("Reservation line is invalid"), { code: "INVALID_COMMAND" });
    }

    const quantity = (quantities.get(line.productId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity)) {
      throw Object.assign(new Error("Reservation quantity is invalid"), { code: "INVALID_COMMAND" });
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
    (this as Error & { code?: string }).code = "INSUFFICIENT_INVENTORY";
  }
}

export class ReservationIdempotencyConflictError extends Error {
  public constructor() {
    super("Reservation idempotency key was reused with different product quantities");
    this.name = "ReservationIdempotencyConflictError";
    (this as Error & { code?: string }).code = "CONFLICT";
  }
}

@Injectable()
export class InMemoryCatalogStore implements CatalogStore {
  private readonly products: Product[];
  private readonly defaultProducts: Product[] = [
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
    expiresAt: Date;
  }>();
  private operationTail: Promise<void> = Promise.resolve();

  public constructor(products?: Product[]) {
    this.products = (products ?? this.defaultProducts).map((product) => ({ ...product }));
  }

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
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });
      return result;
    });
  }

  public async reserveInventory(
    orderId: string,
    lines: ReservationRequestLine[],
    expiresAt: Date,
  ): Promise<InventoryReservation> {
    if (!orderId.trim() || !(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw Object.assign(new Error("Invalid inventory command"), { code: "INVALID_COMMAND" });
    }
    return this.withExclusiveLock(async () => {
      const requestLines = normalizeReservationLines(lines);
      const existing = this.reservations.get(orderId);
      if (existing) {
        if (JSON.stringify(existing.requestLines) !== JSON.stringify(requestLines)) {
          throw Object.assign(new ReservationIdempotencyConflictError(), { code: "CONFLICT" });
        }
        if (existing.result.status === "RELEASED" || existing.result.status === "COMMITTED") {
          return structuredClone(existing.result);
        }
        return structuredClone({ ...existing.result, status: "ACTIVE" });
      }
      const products = requestLines.map((line) => {
        const product = this.products.find((candidate) => candidate.id === line.productId);
        if (!product || product.stock < line.quantity) {
          throw new InventoryConflictError(`Insufficient stock: ${line.productId}`);
        }
        return { product, quantity: line.quantity };
      });
      const reservation: InventoryReservation = {
        orderId,
        status: "RESERVED",
        reservedAt: new Date().toISOString(),
        lines: products.map(({ product, quantity }) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
          unitPriceCop: product.priceCop,
        })),
      };
      for (const { product, quantity } of products) product.stock -= quantity;
      const active: InventoryReservation = { ...reservation, status: "ACTIVE" };
      this.reservations.set(orderId, { requestLines, result: active, expiresAt });
      return structuredClone(active);
    });
  }

  public async commitInventory(orderId: string): Promise<InventoryReservation> {
    return this.withExclusiveLock(async () => {
      const reservation = this.reservations.get(orderId);
      if (!reservation) throw Object.assign(new Error("Reservation not found"), { code: "NOT_FOUND" });
      if (reservation.result.status === "COMMITTED") return structuredClone(reservation.result);
      if (reservation.result.status !== "ACTIVE") throw Object.assign(new Error("Committed reservation cannot be released"), { code: "CONFLICT" });
      const committed = { ...reservation.result, status: "COMMITTED" as const };
      reservation.result = committed;
      return structuredClone(committed);
    });
  }

  public async releaseInventory(orderId: string): Promise<InventoryReservation> {
    return this.withExclusiveLock(async () => {
      const reservation = this.reservations.get(orderId);
      if (!reservation) throw Object.assign(new Error("Reservation not found"), { code: "NOT_FOUND" });
      if (reservation.result.status === "RELEASED") return structuredClone(reservation.result);
      if (reservation.result.status === "COMMITTED") throw Object.assign(new Error("Committed reservation cannot be released"), { code: "CONFLICT" });
      for (const line of reservation.result.lines) {
        const product = this.products.find((candidate) => candidate.id === line.productId);
        if (product) product.stock += line.quantity;
      }
      const released = { ...reservation.result, status: "RELEASED" as const };
      reservation.result = released;
      return structuredClone(released);
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

  public reserveInventory(
    orderId: string,
    lines: ReservationRequestLine[],
    expiresAt: Date,
  ): Promise<InventoryReservation> {
    if (!orderId.trim()) throw Object.assign(new Error("Order id is required"), { code: "INVALID_COMMAND" });
    return this.store.reserveInventory(orderId, lines, expiresAt);
  }

  public commitInventory(orderId: string): Promise<InventoryReservation> {
    return this.store.commitInventory(orderId);
  }

  public releaseInventory(orderId: string): Promise<InventoryReservation> {
    return this.store.releaseInventory(orderId);
  }
}
