import { Injectable } from "@nestjs/common";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
  imageUrl?: string | null;
  isActive?: boolean;
};

export type ProductInput = {
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  imageUrl: string | null;
  isActive: boolean;
};

export type StockReceipt = {
  idempotencyKey: string;
  adminCustomerId: string;
  reason: string;
  createdAt: string;
  lines: Array<{ productId: string; sku: string; name: string; quantity: number }>;
};

export type ManualSale = {
  idempotencyKey: string;
  adminCustomerId: string;
  createdAt: string;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCop: number;
  }>;
};

export interface CatalogStore {
  listActiveProducts(): Promise<Product[]>;
  listAdminProducts(): Promise<Product[]>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(productId: string, input: ProductInput): Promise<Product>;
  recordStockReceipt(adminCustomerId: string, idempotencyKey: string, reason: string, lines: ReservationRequestLine[]): Promise<StockReceipt>;
  recordManualSale(adminCustomerId: string, idempotencyKey: string, lines: ReservationRequestLine[]): Promise<ManualSale>;
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

export class ManualSaleIdempotencyConflictError extends Error {
  public constructor() {
    super("Manual sale idempotency key was reused with different product quantities");
    this.name = "ManualSaleIdempotencyConflictError";
    (this as Error & { code?: string }).code = "CONFLICT";
  }
}

export class CatalogConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CatalogConflictError";
    (this as Error & { code?: string }).code = "CONFLICT";
  }
}

export class CatalogNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CatalogNotFoundError";
    (this as Error & { code?: string }).code = "NOT_FOUND";
  }
}

export class StockReceiptIdempotencyConflictError extends Error {
  public constructor() {
    super("Stock receipt idempotency key was reused with different details");
    this.name = "StockReceiptIdempotencyConflictError";
    (this as Error & { code?: string }).code = "CONFLICT";
  }
}

export class CatalogInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CatalogInputError";
    (this as Error & { code?: string }).code = "INVALID_COMMAND";
  }
}

export function normalizeProductInput(input: ProductInput): ProductInput {
  const sku = typeof input.sku === "string" ? input.sku.trim().toUpperCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(sku)) {
    throw new CatalogInputError("SKU must be 2–64 characters using letters, numbers, dot, underscore or hyphen");
  }
  if (name.length < 2 || name.length > 160) {
    throw new CatalogInputError("Product name must contain 2–160 characters");
  }
  if (description.length > 5000) {
    throw new CatalogInputError("Product description cannot exceed 5000 characters");
  }
  if (!Number.isSafeInteger(input.priceCop) || input.priceCop < 0 || input.priceCop > 2_000_000_000) {
    throw new CatalogInputError("Price must be a whole COP amount between 0 and 2,000,000,000");
  }
  if (typeof input.isActive !== "boolean") {
    throw new CatalogInputError("Product active status is invalid");
  }
  let imageUrl: string | null = null;
  if (input.imageUrl !== null && input.imageUrl !== undefined && input.imageUrl !== "") {
    if (typeof input.imageUrl !== "string" || input.imageUrl.length > 2048) {
      throw new CatalogInputError("Product image URL is invalid");
    }
    let parsed: URL;
    try {
      parsed = new URL(input.imageUrl);
    } catch {
      throw new CatalogInputError("Product image URL must be a valid HTTPS URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new CatalogInputError("Product image URL must use HTTPS and cannot include credentials");
    }
    imageUrl = parsed.toString();
  }
  return { sku, name, description, priceCop: input.priceCop, imageUrl, isActive: input.isActive };
}

export function normalizeStockReceipt(
  adminCustomerId: string,
  idempotencyKey: string,
  reason: string,
  lines: ReservationRequestLine[],
): { adminCustomerId: string; idempotencyKey: string; reason: string; lines: ReservationRequestLine[] } {
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (!adminCustomerId.trim() || !idempotencyKey.trim() || idempotencyKey.length > 128) {
    throw new CatalogInputError("Administrator and a valid idempotency key are required");
  }
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new CatalogInputError("Stock receipt reason must contain 3–500 characters");
  }
  const normalizedLines = normalizeReservationLines(lines);
  if (normalizedLines.length > 50 || normalizedLines.some((line) => line.quantity > 1_000_000)) {
    throw new CatalogInputError("Stock receipt quantity or number of products exceeds the allowed limit");
  }
  return { adminCustomerId, idempotencyKey: idempotencyKey.trim(), reason: normalizedReason, lines: normalizedLines };
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
    expiresAt: Date | null;
  }>();
  private readonly manualSales = new Map<string, { requestLines: ReservationRequestLine[]; result: ManualSale }>();
  private readonly stockReceipts = new Map<string, { requestFingerprint: string; result: StockReceipt }>();
  private operationTail: Promise<void> = Promise.resolve();

  public constructor(products?: Product[]) {
    this.products = (products ?? this.defaultProducts).map((product) => ({ ...product }));
  }

  public async listActiveProducts(): Promise<Product[]> {
    return this.products
      .filter((product) => product.isActive !== false)
      .map((product) => ({ ...product }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async listAdminProducts(): Promise<Product[]> {
    return this.products
      .map((product) => ({ ...product, isActive: product.isActive !== false, imageUrl: product.imageUrl ?? null }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async createProduct(input: ProductInput): Promise<Product> {
    return this.withExclusiveLock(async () => {
      const normalized = normalizeProductInput(input);
      if (this.products.some((product) => product.sku.toUpperCase() === normalized.sku)) {
        throw new CatalogConflictError("A product with this SKU already exists");
      }
      const product: Product = {
        id: `prod-${crypto.randomUUID()}`,
        ...normalized,
        stock: 0,
      };
      this.products.push(product);
      return { ...product };
    });
  }

  public async updateProduct(productId: string, input: ProductInput): Promise<Product> {
    return this.withExclusiveLock(async () => {
      const normalized = normalizeProductInput(input);
      const product = this.products.find((candidate) => candidate.id === productId);
      if (!product) throw new CatalogNotFoundError("Product not found");
      if (this.products.some((candidate) => candidate.id !== productId && candidate.sku.toUpperCase() === normalized.sku)) {
        throw new CatalogConflictError("A product with this SKU already exists");
      }
      Object.assign(product, normalized);
      return { ...product };
    });
  }

  public async recordStockReceipt(
    adminCustomerId: string,
    idempotencyKey: string,
    reason: string,
    lines: ReservationRequestLine[],
  ): Promise<StockReceipt> {
    const request = normalizeStockReceipt(adminCustomerId, idempotencyKey, reason, lines);
    return this.withExclusiveLock(async () => {
      const fingerprint = JSON.stringify({ adminCustomerId: request.adminCustomerId, reason: request.reason, lines: request.lines });
      const existing = this.stockReceipts.get(request.idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new StockReceiptIdempotencyConflictError();
        return structuredClone(existing.result);
      }
      const products = request.lines.map((line) => {
        const product = this.products.find((candidate) => candidate.id === line.productId);
        if (!product) throw new CatalogNotFoundError(`Product not found: ${line.productId}`);
        if (!Number.isSafeInteger(product.stock + line.quantity) || product.stock + line.quantity > 2_000_000_000) {
          throw new CatalogInputError(`Stock limit exceeded for ${product.sku}`);
        }
        return { product, quantity: line.quantity };
      });
      const result: StockReceipt = {
        idempotencyKey: request.idempotencyKey,
        adminCustomerId: request.adminCustomerId,
        reason: request.reason,
        createdAt: new Date().toISOString(),
        lines: products.map(({ product, quantity }) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
        })),
      };
      for (const { product, quantity } of products) product.stock += quantity;
      this.stockReceipts.set(request.idempotencyKey, { requestFingerprint: fingerprint, result: structuredClone(result) });
      return result;
    });
  }

  public async recordManualSale(
    adminCustomerId: string,
    idempotencyKey: string,
    lines: ReservationRequestLine[],
  ): Promise<ManualSale> {
    return this.withExclusiveLock(async () => {
      const requestLines = normalizeReservationLines(lines);
      const existing = this.manualSales.get(idempotencyKey);
      if (existing) {
        if (JSON.stringify(existing.requestLines) !== JSON.stringify(requestLines)) {
          throw new ManualSaleIdempotencyConflictError();
        }
        return structuredClone(existing.result);
      }

      const products = requestLines.map((line) => {
        const product = this.products.find((candidate) => candidate.id === line.productId);
        if (!product || product.isActive === false || product.stock < line.quantity) {
          throw new InventoryConflictError(`Insufficient stock: ${line.productId}`);
        }
        return { product, quantity: line.quantity };
      });
      const result: ManualSale = {
        idempotencyKey,
        adminCustomerId,
        createdAt: new Date().toISOString(),
        lines: products.map(({ product, quantity }) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
          unitPriceCop: product.priceCop,
        })),
      };
      for (const { product, quantity } of products) product.stock -= quantity;
      this.manualSales.set(idempotencyKey, { requestLines, result: structuredClone(result) });
      return result;
    });
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
        expiresAt: null,
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
      if (reservation.result.status !== "ACTIVE" && reservation.result.status !== "RESERVED") {
        throw Object.assign(new Error("Reservation cannot be committed"), { code: "CONFLICT" });
      }
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

  public async listAdminProducts(): Promise<Product[]> {
    return this.store.listAdminProducts();
  }

  public async createProduct(input: ProductInput): Promise<Product> {
    return this.store.createProduct(normalizeProductInput(input));
  }

  public async updateProduct(productId: string, input: ProductInput): Promise<Product> {
    if (!productId.trim()) throw new CatalogInputError("Product id is required");
    return this.store.updateProduct(productId, normalizeProductInput(input));
  }

  public async receiveStock(
    adminCustomerId: string,
    idempotencyKey: string,
    reason: string,
    lines: ReservationRequestLine[],
  ): Promise<StockReceipt> {
    return this.store.recordStockReceipt(adminCustomerId, idempotencyKey, reason, lines);
  }

  public async recordManualSale(
    adminCustomerId: string,
    idempotencyKey: string,
    lines: ReservationRequestLine[],
  ): Promise<ManualSale> {
    if (
      !adminCustomerId.trim() ||
      !idempotencyKey.trim() ||
      idempotencyKey.trim().length > 128
    ) {
      throw Object.assign(new Error("Administrator and idempotency key are required"), {
        code: "INVALID_COMMAND",
      });
    }
    if (lines.length > 50) {
      throw Object.assign(new Error("A manual sale cannot include more than 50 products"), {
        code: "INVALID_COMMAND",
      });
    }
    return this.store.recordManualSale(
      adminCustomerId,
      idempotencyKey,
      normalizeReservationLines(lines),
    );
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
