import { Injectable } from "@nestjs/common";
import {
  CATALOG_CATEGORY_THEMES,
  CATALOG_PRODUCT_IMAGE_LIMIT,
} from "@mileshop/contracts";
import type {
  CatalogCategory,
  CatalogCategoryInput,
  CatalogCategorySummary,
  CatalogCategoryTheme,
  CatalogProductImage,
  CatalogProductImageInput,
  CatalogAnnouncement,
  CatalogAnnouncementInput,
  CatalogPromotion,
  CatalogPromotionInput,
  CatalogProductPromotion,
} from "@mileshop/contracts";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
  imageUrl?: string | null;
  imageFileId?: string | null;
  images?: CatalogProductImage[];
  priceBeforeDiscountCop?: number;
  promotion?: CatalogProductPromotion | null;
  categoryId?: string | null;
  category?: CategorySummary | null;
  isActive?: boolean;
};

export const CATEGORY_THEMES = CATALOG_CATEGORY_THEMES;
export type CategoryTheme = CatalogCategoryTheme;
export type CategorySummary = CatalogCategorySummary;
export type Category = CatalogCategory;
export type CategoryInput = CatalogCategoryInput;
export type Promotion = CatalogPromotion;
export type PromotionInput = CatalogPromotionInput;
export type Announcement = CatalogAnnouncement;
export type AnnouncementInput = CatalogAnnouncementInput;

export type ProductInput = {
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  imageUrl: string | null;
  imageFileId?: string | null;
  images?: CatalogProductImageInput[];
  categoryId?: string | null;
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
  listCategories(): Promise<Category[]>;
  createCategory(input: CategoryInput): Promise<Category>;
  updateCategory(categoryId: string, input: CategoryInput): Promise<Category>;
  deleteCategory(categoryId: string): Promise<void>;
  listPromotions(includeInactive?: boolean): Promise<Promotion[]>;
  createPromotion(input: PromotionInput): Promise<Promotion>;
  updatePromotion(promotionId: string, input: PromotionInput): Promise<Promotion>;
  deletePromotion(promotionId: string): Promise<void>;
  listAnnouncements(includeInactive?: boolean): Promise<Announcement[]>;
  createAnnouncement(input: AnnouncementInput): Promise<Announcement>;
  updateAnnouncement(announcementId: string, input: AnnouncementInput): Promise<Announcement>;
  deleteAnnouncement(announcementId: string): Promise<void>;
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

function validateMarketingDates(startsAt: string, endsAt: string): { startsAt: Date; endsAt: Date } {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end.getTime() <= start.getTime()
  ) {
    throw new CatalogInputError("Campaign end must be later than its start");
  }
  return { startsAt: start, endsAt: end };
}

export function normalizePromotionInput(input: PromotionInput): PromotionInput {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (title.length < 3 || title.length > 100) {
    throw new CatalogInputError("Promotion title must contain 3–100 characters");
  }
  if (description.length > 1000) {
    throw new CatalogInputError("Promotion description cannot exceed 1000 characters");
  }
  if (typeof input.isActive !== "boolean") {
    throw new CatalogInputError("Promotion status is invalid");
  }
  const dates = validateMarketingDates(input.startsAt, input.endsAt);
  if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > 100) {
    throw new CatalogInputError("A promotion must include between 1 and 100 products");
  }
  const productIds = new Set<string>();
  const products = input.products.map((product) => {
    if (
      typeof product.productId !== "string" ||
      !product.productId.trim() ||
      !Number.isSafeInteger(product.discountPercent) ||
      product.discountPercent < 1 ||
      product.discountPercent > 90 ||
      productIds.has(product.productId)
    ) {
      throw new CatalogInputError("Promotion products or discount percentages are invalid");
    }
    const productId = product.productId.trim();
    if (productIds.has(productId)) {
      throw new CatalogInputError("Promotion products or discount percentages are invalid");
    }
    productIds.add(productId);
    return { productId, discountPercent: product.discountPercent };
  });
  return {
    title,
    description,
    startsAt: dates.startsAt.toISOString(),
    endsAt: dates.endsAt.toISOString(),
    isActive: input.isActive,
    products,
  };
}

export function normalizeAnnouncementInput(input: AnnouncementInput): AnnouncementInput {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const linkLabel = typeof input.linkLabel === "string" ? input.linkLabel.trim() : null;
  const linkUrl = typeof input.linkUrl === "string" ? input.linkUrl.trim() : null;
  if (title.length < 3 || title.length > 100 || message.length < 3 || message.length > 500) {
    throw new CatalogInputError("Announcement title or message is invalid");
  }
  if (typeof input.isActive !== "boolean") {
    throw new CatalogInputError("Announcement status is invalid");
  }
  if ((linkUrl === null) !== (linkLabel === null)) {
    throw new CatalogInputError("Announcement links require both a URL and a label");
  }
  if (linkLabel !== null && (linkLabel.length < 2 || linkLabel.length > 40)) {
    throw new CatalogInputError("Announcement link label must contain 2–40 characters");
  }
  if (linkUrl !== null) {
    let parsed: URL;
    try {
      parsed = new URL(linkUrl);
    } catch {
      throw new CatalogInputError("Announcement link must be a valid HTTPS URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new CatalogInputError("Announcement link must use HTTPS and cannot include credentials");
    }
  }
  const dates = validateMarketingDates(input.startsAt, input.endsAt);
  return {
    title,
    message,
    linkUrl,
    linkLabel,
    startsAt: dates.startsAt.toISOString(),
    endsAt: dates.endsAt.toISOString(),
    isActive: input.isActive,
  };
}

export function normalizeProductInput(
  input: ProductInput,
): ProductInput & { images: CatalogProductImageInput[] } {
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
  let categoryId: string | null | undefined;
  if (input.categoryId !== undefined) {
    if (input.categoryId !== null && (typeof input.categoryId !== "string" || !input.categoryId.trim())) {
      throw new CatalogInputError("Product category is invalid");
    }
    categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : null;
  }
  const normalizeImage = (
    imageUrlInput: unknown,
    imageFileIdInput: unknown,
  ): CatalogProductImageInput => {
    if (typeof imageUrlInput !== "string" || imageUrlInput.length > 2048) {
      throw new CatalogInputError("Product image URL is invalid");
    }
    let parsed: URL;
    try {
      parsed = new URL(imageUrlInput);
    } catch {
      throw new CatalogInputError("Product image URL must be a valid HTTPS URL");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new CatalogInputError("Product image URL must use HTTPS and cannot include credentials");
    }

    let imageFileId: string | null | undefined;
    if (imageFileIdInput !== undefined && imageFileIdInput !== null && imageFileIdInput !== "") {
      if (
        typeof imageFileIdInput !== "string" ||
        imageFileIdInput.length > 128 ||
        !/^[A-Za-z0-9_-]+$/.test(imageFileIdInput)
      ) {
        throw new CatalogInputError("Product image file reference is invalid");
      }
      if (parsed.hostname !== "ik.imagekit.io") {
        throw new CatalogInputError("A managed image must use its ImageKit URL");
      }
      imageFileId = imageFileIdInput;
    } else if (imageFileIdInput !== undefined) {
      imageFileId = null;
    }
    return {
      imageUrl: parsed.toString(),
      ...(imageFileId !== undefined ? { imageFileId } : {}),
    };
  };

  let images: CatalogProductImageInput[];
  if (input.images !== undefined) {
    if (!Array.isArray(input.images) || input.images.length > CATALOG_PRODUCT_IMAGE_LIMIT) {
      throw new CatalogInputError(`A product can have at most ${CATALOG_PRODUCT_IMAGE_LIMIT} images`);
    }
    images = input.images.map((image) => {
      if (typeof image !== "object" || image === null || !("imageUrl" in image)) {
        throw new CatalogInputError("Product image is invalid");
      }
      return normalizeImage(
        image.imageUrl,
        "imageFileId" in image ? image.imageFileId : undefined,
      );
    });
  } else if (input.imageUrl) {
    images = [normalizeImage(input.imageUrl, input.imageFileId)];
  } else {
    if (input.imageFileId !== undefined && input.imageFileId !== null && input.imageFileId !== "") {
      throw new CatalogInputError("A managed image must use its ImageKit URL");
    }
    images = [];
  }
  const imageUrl = images[0]?.imageUrl ?? null;
  const imageFileId =
    input.images !== undefined
      ? images[0]?.imageFileId ?? null
      : images[0]?.imageFileId ??
        (images[0] && input.imageFileId === undefined ? undefined : null);
  return {
    sku,
    name,
    description,
    priceCop: input.priceCop,
    imageUrl,
    ...(imageFileId !== undefined ? { imageFileId } : {}),
    images,
    ...(categoryId !== undefined ? { categoryId } : {}),
    isActive: input.isActive,
  };
}

export function normalizeCategoryInput(input: CategoryInput): CategoryInput & { slug: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 60) {
    throw new CatalogInputError("Category name must contain 2–60 characters");
  }
  if (!CATEGORY_THEMES.includes(input.theme)) {
    throw new CatalogInputError("Category theme is invalid");
  }
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new CatalogInputError("Category name must contain letters or numbers");
  }
  return { name, slug, theme: input.theme };
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
  private readonly categories: CategorySummary[];
  private readonly promotions: Promotion[] = [];
  private readonly announcements: Announcement[] = [];
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

  public constructor(products?: Product[], categories: CategorySummary[] = []) {
    this.products = (products ?? this.defaultProducts).map((product) => ({ ...product }));
    this.categories = categories.map((category) => ({ ...category }));
  }

  public async listActiveProducts(): Promise<Product[]> {
    const now = Date.now();
    return this.products
      .filter((product) => product.isActive !== false)
      .map((product) => {
        const promotion = this.getProductPromotion(product.id, now);
        const priceCop = promotion
          ? Math.round((product.priceCop * (100 - promotion.discountPercent)) / 100)
          : product.priceCop;
        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description,
          priceCop,
          stock: product.stock,
          ...(promotion ? { priceBeforeDiscountCop: product.priceCop, promotion } : {}),
          ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
          ...(product.images?.length
            ? {
                images: product.images.map(({ imageUrl, position }) => ({
                  imageUrl,
                  position,
                })),
              }
            : {}),
          ...(this.getCategorySummary(product.categoryId)
            ? { category: this.getCategorySummary(product.categoryId) }
            : {}),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async listAdminProducts(): Promise<Product[]> {
    return this.products
      .map((product) => ({
        ...product,
        isActive: product.isActive !== false,
        imageUrl: product.imageUrl ?? null,
        imageFileId: product.imageFileId ?? null,
        images: (product.images ?? []).map((image, position) => ({
          ...image,
          imageFileId: image.imageFileId ?? null,
          position,
        })),
        categoryId: product.categoryId ?? null,
        category: this.getCategorySummary(product.categoryId),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async listCategories(): Promise<Category[]> {
    return this.categories
      .map((category) => ({
        ...category,
        productCount: this.products.filter((product) => product.categoryId === category.id).length,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "es"));
  }

  public async createCategory(input: CategoryInput): Promise<Category> {
    const normalized = normalizeCategoryInput(input);
    if (this.categories.some((category) => category.slug === normalized.slug)) {
      throw new CatalogConflictError("A category with this name already exists");
    }
    const category: CategorySummary = {
      id: `cat-${crypto.randomUUID()}`,
      ...normalized,
    };
    this.categories.push(category);
    return { ...category, productCount: 0 };
  }

  public async updateCategory(categoryId: string, input: CategoryInput): Promise<Category> {
    const normalized = normalizeCategoryInput(input);
    const category = this.categories.find((candidate) => candidate.id === categoryId);
    if (!category) throw new CatalogNotFoundError("Category not found");
    if (this.categories.some((candidate) => candidate.id !== categoryId && candidate.slug === normalized.slug)) {
      throw new CatalogConflictError("A category with this name already exists");
    }
    Object.assign(category, normalized);
    return {
      ...category,
      productCount: this.products.filter((product) => product.categoryId === categoryId).length,
    };
  }

  public async deleteCategory(categoryId: string): Promise<void> {
    const index = this.categories.findIndex((category) => category.id === categoryId);
    if (index < 0) throw new CatalogNotFoundError("Category not found");
    if (this.products.some((product) => product.categoryId === categoryId)) {
      throw new CatalogConflictError("Reassign products before deleting this category");
    }
    this.categories.splice(index, 1);
  }

  public async listPromotions(includeInactive = false): Promise<Promotion[]> {
    const now = Date.now();
    return this.promotions
      .filter((promotion) =>
        includeInactive ||
        (promotion.isActive &&
          new Date(promotion.startsAt).getTime() <= now &&
          new Date(promotion.endsAt).getTime() > now),
      )
      .map((promotion) => structuredClone(promotion))
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  public async createPromotion(input: PromotionInput): Promise<Promotion> {
    const normalized = normalizePromotionInput(input);
    this.assertPromotionProductsAvailable(normalized);
    const promotion: Promotion = {
      ...normalized,
      id: `promotion-${crypto.randomUUID()}`,
      products: normalized.products.map((item) => {
        const product = this.products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new CatalogNotFoundError(`Product not found: ${item.productId}`);
        return { ...item, name: product.name, sku: product.sku };
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.promotions.push(promotion);
    return structuredClone(promotion);
  }

  public async updatePromotion(promotionId: string, input: PromotionInput): Promise<Promotion> {
    const normalized = normalizePromotionInput(input);
    const index = this.promotions.findIndex((promotion) => promotion.id === promotionId);
    if (index < 0) throw new CatalogNotFoundError("Promotion not found");
    this.assertPromotionProductsAvailable(normalized, promotionId);
    const promotion: Promotion = {
      ...normalized,
      id: promotionId,
      products: normalized.products.map((item) => {
        const product = this.products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new CatalogNotFoundError(`Product not found: ${item.productId}`);
        return { ...item, name: product.name, sku: product.sku };
      }),
      createdAt: this.promotions[index]!.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.promotions[index] = promotion;
    return structuredClone(promotion);
  }

  public async deletePromotion(promotionId: string): Promise<void> {
    const index = this.promotions.findIndex((promotion) => promotion.id === promotionId);
    if (index < 0) throw new CatalogNotFoundError("Promotion not found");
    this.promotions.splice(index, 1);
  }

  public async listAnnouncements(includeInactive = false): Promise<Announcement[]> {
    const now = Date.now();
    return this.announcements
      .filter((announcement) =>
        includeInactive ||
        (announcement.isActive &&
          new Date(announcement.startsAt).getTime() <= now &&
          new Date(announcement.endsAt).getTime() > now),
      )
      .map((announcement) => structuredClone(announcement))
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  public async createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
    const normalized = normalizeAnnouncementInput(input);
    const now = new Date().toISOString();
    const announcement: Announcement = {
      ...normalized,
      id: `announcement-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.announcements.push(announcement);
    return structuredClone(announcement);
  }

  public async updateAnnouncement(announcementId: string, input: AnnouncementInput): Promise<Announcement> {
    const normalized = normalizeAnnouncementInput(input);
    const index = this.announcements.findIndex((announcement) => announcement.id === announcementId);
    if (index < 0) throw new CatalogNotFoundError("Announcement not found");
    const announcement: Announcement = {
      ...normalized,
      id: announcementId,
      createdAt: this.announcements[index]!.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.announcements[index] = announcement;
    return structuredClone(announcement);
  }

  public async deleteAnnouncement(announcementId: string): Promise<void> {
    const index = this.announcements.findIndex((announcement) => announcement.id === announcementId);
    if (index < 0) throw new CatalogNotFoundError("Announcement not found");
    this.announcements.splice(index, 1);
  }

  private assertPromotionProductsAvailable(input: PromotionInput, excludedPromotionId?: string): void {
    const productIds = new Set(input.products.map((product) => product.productId));
    for (const productId of productIds) {
      if (!this.products.some((product) => product.id === productId)) {
        throw new CatalogNotFoundError(`Product not found: ${productId}`);
      }
    }
    const startsAt = new Date(input.startsAt).getTime();
    const endsAt = new Date(input.endsAt).getTime();
    const conflict = this.promotions.some((promotion) =>
      promotion.id !== excludedPromotionId &&
      promotion.isActive &&
      new Date(promotion.startsAt).getTime() < endsAt &&
      new Date(promotion.endsAt).getTime() > startsAt &&
      promotion.products.some((product) => productIds.has(product.productId)),
    );
    if (conflict) {
      throw new CatalogConflictError("An active promotion already overlaps for one or more products");
    }
  }

  private getProductPromotion(productId: string, now: number): CatalogProductPromotion | null {
    for (const promotion of this.promotions) {
      if (
        promotion.isActive &&
        new Date(promotion.startsAt).getTime() <= now &&
        new Date(promotion.endsAt).getTime() > now
      ) {
        const product = promotion.products.find((item) => item.productId === productId);
        if (product) {
          return {
            id: promotion.id,
            title: promotion.title,
            discountPercent: product.discountPercent,
            startsAt: promotion.startsAt,
            endsAt: promotion.endsAt,
          };
        }
      }
    }
    return null;
  }

  private getEffectivePrice(product: Product, now: number): number {
    const promotion = this.getProductPromotion(product.id, now);
    return promotion
      ? Math.round((product.priceCop * (100 - promotion.discountPercent)) / 100)
      : product.priceCop;
  }

  public async createProduct(input: ProductInput): Promise<Product> {
    return this.withExclusiveLock(async () => {
      const normalized = normalizeProductInput(input);
      this.assertCategoryExists(normalized.categoryId);
      if (this.products.some((product) => product.sku.toUpperCase() === normalized.sku)) {
        throw new CatalogConflictError("A product with this SKU already exists");
      }
      const product: Product = {
        id: `prod-${crypto.randomUUID()}`,
        ...normalized,
        imageUrl: normalized.images[0]?.imageUrl ?? null,
        imageFileId: normalized.images[0]?.imageFileId ?? null,
        images: normalized.images.map((image, position) => ({
          ...image,
          imageFileId: image.imageFileId ?? null,
          position,
        })),
        categoryId: normalized.categoryId ?? null,
        stock: 0,
      };
      this.products.push(product);
      return { ...product, category: this.getCategorySummary(product.categoryId) };
    });
  }

  public async updateProduct(productId: string, input: ProductInput): Promise<Product> {
    return this.withExclusiveLock(async () => {
      const normalized = normalizeProductInput(input);
      this.assertCategoryExists(normalized.categoryId);
      const product = this.products.find((candidate) => candidate.id === productId);
      if (!product) throw new CatalogNotFoundError("Product not found");
      if (this.products.some((candidate) => candidate.id !== productId && candidate.sku.toUpperCase() === normalized.sku)) {
        throw new CatalogConflictError("A product with this SKU already exists");
      }
      const images = normalized.images.map((image, position) => {
        const previousImage = product.images?.find(
          (candidate) => candidate.imageUrl === image.imageUrl,
        );
        return {
          ...image,
          imageFileId:
            image.imageFileId === undefined
              ? previousImage?.imageFileId ?? null
              : image.imageFileId,
          position,
        };
      });
      Object.assign(product, {
        ...normalized,
        imageUrl: images[0]?.imageUrl ?? null,
        imageFileId: images[0]?.imageFileId ?? null,
        images,
      });
      return { ...product, categoryId: product.categoryId ?? null, category: this.getCategorySummary(product.categoryId) };
    });
  }

  private assertCategoryExists(categoryId: string | null | undefined): void {
    if (categoryId && !this.categories.some((category) => category.id === categoryId)) {
      throw new CatalogNotFoundError("Category not found");
    }
  }

  private getCategorySummary(categoryId: string | null | undefined): CategorySummary | null {
    const category = this.categories.find((candidate) => candidate.id === categoryId);
    return category ? { ...category } : null;
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
          unitPriceCop: this.getEffectivePrice(product, Date.now()),
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
          unitPriceCop: this.getEffectivePrice(product, Date.now()),
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
          unitPriceCop: this.getEffectivePrice(product, Date.now()),
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

  public async listCategories(): Promise<Category[]> {
    return this.store.listCategories();
  }

  public async createCategory(input: CategoryInput): Promise<Category> {
    return this.store.createCategory(normalizeCategoryInput(input));
  }

  public async updateCategory(categoryId: string, input: CategoryInput): Promise<Category> {
    if (!categoryId.trim()) throw new CatalogInputError("Category id is required");
    return this.store.updateCategory(categoryId, normalizeCategoryInput(input));
  }

  public async deleteCategory(categoryId: string): Promise<void> {
    if (!categoryId.trim()) throw new CatalogInputError("Category id is required");
    return this.store.deleteCategory(categoryId);
  }

  public async listPromotions(includeInactive = false): Promise<Promotion[]> {
    return this.store.listPromotions(includeInactive);
  }

  public async createPromotion(input: PromotionInput): Promise<Promotion> {
    return this.store.createPromotion(normalizePromotionInput(input));
  }

  public async updatePromotion(promotionId: string, input: PromotionInput): Promise<Promotion> {
    if (!promotionId.trim()) throw new CatalogInputError("Promotion id is required");
    return this.store.updatePromotion(promotionId, normalizePromotionInput(input));
  }

  public async deletePromotion(promotionId: string): Promise<void> {
    if (!promotionId.trim()) throw new CatalogInputError("Promotion id is required");
    return this.store.deletePromotion(promotionId);
  }

  public async listAnnouncements(includeInactive = false): Promise<Announcement[]> {
    return this.store.listAnnouncements(includeInactive);
  }

  public async createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
    return this.store.createAnnouncement(normalizeAnnouncementInput(input));
  }

  public async updateAnnouncement(announcementId: string, input: AnnouncementInput): Promise<Announcement> {
    if (!announcementId.trim()) throw new CatalogInputError("Announcement id is required");
    return this.store.updateAnnouncement(announcementId, normalizeAnnouncementInput(input));
  }

  public async deleteAnnouncement(announcementId: string): Promise<void> {
    if (!announcementId.trim()) throw new CatalogInputError("Announcement id is required");
    return this.store.deleteAnnouncement(announcementId);
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
