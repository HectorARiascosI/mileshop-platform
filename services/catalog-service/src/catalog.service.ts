import { Injectable } from "@nestjs/common";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

export type InventoryReservationLine = {
  productId: string;
  quantity: number;
};

export type InventoryReservationStatus = "ACTIVE" | "COMMITTED" | "RELEASED";

export type InventoryReservationResult = {
  orderId: string;
  status: InventoryReservationStatus;
  expiresAt: Date;
};

export type NormalizedInventoryLine = InventoryReservationLine;

export type InventoryCommandErrorCode =
  | "INVALID_COMMAND"
  | "INSUFFICIENT_INVENTORY"
  | "NOT_FOUND"
  | "CONFLICT";

export class InventoryCommandError extends Error {
  public constructor(
    public readonly code: InventoryCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InventoryCommandError";
  }
}

export function normalizeInventoryLines(
  lines: InventoryReservationLine[],
): NormalizedInventoryLine[] {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
    throw new InventoryCommandError(
      "INVALID_COMMAND",
      "An inventory command must include between 1 and 100 lines",
    );
  }

  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (
      typeof line.productId !== "string" ||
      line.productId.trim().length === 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new InventoryCommandError(
        "INVALID_COMMAND",
        "Inventory lines require a product ID and a positive integer quantity",
      );
    }

    const productId = line.productId.trim();
    const quantity = (quantities.get(productId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity)) {
      throw new InventoryCommandError(
        "INVALID_COMMAND",
        "Inventory line quantity exceeds the supported range",
      );
    }
    quantities.set(productId, quantity);
  }

  return [...quantities.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
}

export function inventoryFingerprint(lines: NormalizedInventoryLine[]): string {
  return JSON.stringify(lines);
}

export function validateInventoryOrderId(orderId: string): void {
  if (typeof orderId !== "string" || orderId.trim().length === 0) {
    throw new InventoryCommandError("INVALID_COMMAND", "Order ID is required");
  }
}

export function validateReservationExpiry(expiresAt: Date): void {
  if (
    !(expiresAt instanceof Date) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw new InventoryCommandError(
      "INVALID_COMMAND",
      "Reservation expiry must be in the future",
    );
  }
}

export interface CatalogStore {
  listActiveProducts(): Promise<Product[]>;
  reserveInventory(
    orderId: string,
    lines: NormalizedInventoryLine[],
    expiresAt: Date,
  ): Promise<InventoryReservationResult>;
  commitInventory(orderId: string): Promise<InventoryReservationResult>;
  releaseInventory(orderId: string): Promise<InventoryReservationResult>;
}

type StoredProduct = Product & {
  reservedStock: number;
  isActive: boolean;
};

@Injectable()
export class InMemoryCatalogStore implements CatalogStore {
  private readonly products: StoredProduct[];
  private readonly reservations = new Map<
    string,
    {
      fingerprint: string;
      status: InventoryReservationStatus;
      expiresAt: Date;
      lines: NormalizedInventoryLine[];
    }
  >();

  public constructor(products?: Product[]) {
    this.products = (products ?? [
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
    ]).map((product) => ({
      ...structuredClone(product),
      reservedStock: 0,
      isActive: true,
    }));
  }

  public async listActiveProducts(): Promise<Product[]> {
    return this.products
      .filter((product) => product.isActive)
      .map(({ id, sku, name, description, priceCop, stock, reservedStock }) => ({
        id,
        sku,
        name,
        description,
        priceCop,
        stock: stock - reservedStock,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async reserveInventory(
    orderId: string,
    lines: NormalizedInventoryLine[],
    expiresAt: Date,
  ): Promise<InventoryReservationResult> {
    validateInventoryOrderId(orderId);
    const normalizedLines = normalizeInventoryLines(lines);
    const requestFingerprint = inventoryFingerprint(normalizedLines);
    const existing = this.reservations.get(orderId);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) {
        throw new InventoryCommandError(
          "CONFLICT",
          "The order already has a reservation with a different payload",
        );
      }
      return reservationResult(orderId, existing.status, existing.expiresAt);
    }
    validateReservationExpiry(expiresAt);

    const products = normalizedLines.map((line) => {
      const product = this.products.find((candidate) => candidate.id === line.productId);
      if (!product) {
        throw new InventoryCommandError("NOT_FOUND", `Product not found: ${line.productId}`);
      }
      if (!product.isActive) {
        throw new InventoryCommandError("NOT_FOUND", `Product not found: ${line.productId}`);
      }
      if (product.stock - product.reservedStock < line.quantity) {
        throw new InventoryCommandError(
          "INSUFFICIENT_INVENTORY",
          `Insufficient inventory for product: ${line.productId}`,
        );
      }
      return { product, quantity: line.quantity };
    });

    for (const { product, quantity } of products) {
      product.reservedStock += quantity;
    }
    this.reservations.set(orderId, {
      fingerprint: requestFingerprint,
      status: "ACTIVE",
      expiresAt: new Date(expiresAt),
      lines: normalizedLines,
    });
    return reservationResult(orderId, "ACTIVE", expiresAt);
  }

  public async commitInventory(orderId: string): Promise<InventoryReservationResult> {
    validateInventoryOrderId(orderId);
    const reservation = this.reservations.get(orderId);
    if (!reservation) {
      throw new InventoryCommandError("NOT_FOUND", `Reservation not found for order: ${orderId}`);
    }
    if (reservation.status === "COMMITTED") {
      return reservationResult(orderId, reservation.status, reservation.expiresAt);
    }
    if (reservation.status !== "ACTIVE") {
      throw new InventoryCommandError(
        "CONFLICT",
        `Cannot commit a ${reservation.status.toLowerCase()} reservation`,
      );
    }

    const products = reservation.lines.map((line) => {
      const product = this.products.find((candidate) => candidate.id === line.productId);
      if (
        !product ||
        product.stock < line.quantity ||
        product.reservedStock < line.quantity
      ) {
        throw new Error(`Inventory counters are inconsistent for product: ${line.productId}`);
      }
      return { product, quantity: line.quantity };
    });
    for (const { product, quantity } of products) {
      product.stock -= quantity;
      product.reservedStock -= quantity;
    }
    reservation.status = "COMMITTED";
    return reservationResult(orderId, reservation.status, reservation.expiresAt);
  }

  public async releaseInventory(orderId: string): Promise<InventoryReservationResult> {
    validateInventoryOrderId(orderId);
    const reservation = this.reservations.get(orderId);
    if (!reservation) {
      throw new InventoryCommandError("NOT_FOUND", `Reservation not found for order: ${orderId}`);
    }
    if (reservation.status === "RELEASED") {
      return reservationResult(orderId, reservation.status, reservation.expiresAt);
    }
    if (reservation.status !== "ACTIVE") {
      throw new InventoryCommandError(
        "CONFLICT",
        `Cannot release a ${reservation.status.toLowerCase()} reservation`,
      );
    }

    const products = reservation.lines.map((line) => {
      const product = this.products.find((candidate) => candidate.id === line.productId);
      if (!product || product.reservedStock < line.quantity) {
        throw new Error(`Reserved inventory counter is inconsistent for product: ${line.productId}`);
      }
      return { product, quantity: line.quantity };
    });
    for (const { product, quantity } of products) {
      product.reservedStock -= quantity;
    }
    reservation.status = "RELEASED";
    return reservationResult(orderId, reservation.status, reservation.expiresAt);
  }
}

@Injectable()
export class CatalogService {
  public constructor(private readonly store: CatalogStore) {}

  public async listProducts(): Promise<Product[]> {
    return this.store.listActiveProducts();
  }

  public async reserveInventory(
    orderId: string,
    lines: InventoryReservationLine[],
    expiresAt: Date,
  ): Promise<InventoryReservationResult> {
    return this.store.reserveInventory(orderId, lines, expiresAt);
  }

  public async commitInventory(orderId: string): Promise<InventoryReservationResult> {
    return this.store.commitInventory(orderId);
  }

  public async releaseInventory(orderId: string): Promise<InventoryReservationResult> {
    return this.store.releaseInventory(orderId);
  }
}

function reservationResult(
  orderId: string,
  status: InventoryReservationStatus,
  expiresAt: Date,
): InventoryReservationResult {
  return { orderId, status, expiresAt: new Date(expiresAt) };
}
