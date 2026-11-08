import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  CatalogAnnouncement,
  CatalogAnnouncementInput,
  CatalogCategory,
  CatalogCategoryInput,
  CatalogCategorySummary,
  CatalogProductImage,
  CatalogProductImageInput,
  CatalogPromotion,
  CatalogPromotionInput,
} from "@mileshop/contracts";

export const CATALOG_FETCH = "CATALOG_FETCH";

export type GatewayProduct = {
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
  promotion?: {
    id: string;
    title: string;
    discountPercent: number;
    startsAt: string;
    endsAt: string;
  } | null;
  categoryId?: string | null;
  category?: CatalogCategorySummary | null;
  isActive?: boolean;
};

export type ManualSaleLineInput = { productId: string; quantity: number };
export type CatalogProductInput = {
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
export type CatalogProductDeletionResult = {
  deleted: true;
  relatedRecords: {
    images: number;
    promotionAssignments: number;
    manualSaleLines: number;
    stockReceiptLines: number;
    reservationLines: number;
    inventoryMovements: number;
  };
  imageFileIds: string[];
};
export type StockReceiptLineInput = ManualSaleLineInput;
export type StockReceiptResult = {
  idempotencyKey: string;
  adminCustomerId: string;
  reason: string;
  createdAt: string;
  lines: Array<StockReceiptLineInput & { sku: string; name: string }>;
};
export type ManualSaleResult = {
  idempotencyKey: string;
  adminCustomerId: string;
  createdAt: string;
  lines: Array<ManualSaleLineInput & {
    sku: string;
    name: string;
    unitPriceCop: number;
  }>;
};

type CatalogResponse = { data: GatewayProduct[] };
type AnnouncementResponse = { data: CatalogAnnouncement[] };
type PromotionResponse = { data: CatalogPromotion[] };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

@Injectable()
export class CatalogClient {
  private readonly baseUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020";
  private readonly fetcher: FetchLike;

  public constructor(@Inject(CATALOG_FETCH) fetcher: FetchLike) {
    this.fetcher = fetcher;
  }

  public async listProducts(): Promise<GatewayProduct[]> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/products`, {
        signal: AbortSignal.timeout(3_000),
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`catalog-service returned ${response.status}`);
      }

      const payload = (await response.json()) as CatalogResponse;
      return payload.data;
    } catch {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }
  }

  public async listAnnouncements(): Promise<CatalogAnnouncement[]> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/announcements`, {
        signal: AbortSignal.timeout(3_000),
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`catalog-service returned ${response.status}`);
      const payload = (await response.json()) as AnnouncementResponse;
      return payload.data;
    } catch {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }
  }

  public async listActivePromotions(): Promise<CatalogPromotion[]> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/promotions`, {
        signal: AbortSignal.timeout(3_000),
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`catalog-service returned ${response.status}`);
      const payload = (await response.json()) as PromotionResponse;
      return payload.data;
    } catch {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }
  }

  public async recordManualSale(
    adminCustomerId: string,
    idempotencyKey: string,
    lines: ManualSaleLineInput[],
  ): Promise<ManualSaleResult> {
    const token = process.env.CATALOG_INVENTORY_COMMAND_TOKEN?.trim();
    if (!token || token.length < 32) {
      throw new ServiceUnavailableException("Catalog administration is not configured");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/internal/admin/manual-sales`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ adminCustomerId, lines }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }

    if (response.status === 400) {
      throw new BadRequestException("Manual sale payload rejected by catalog service");
    }
    if (response.status === 409) {
      throw new ConflictException("Manual sale conflicts with inventory or a previous request");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }
    const payload = (await response.json()) as { data: ManualSaleResult };
    return payload.data;
  }

  public async listAdminProducts(): Promise<GatewayProduct[]> {
    return this.adminRequest<GatewayProduct[]>("GET", "/internal/admin/products");
  }

  public async listCategories(): Promise<CatalogCategory[]> {
    return this.adminRequest<CatalogCategory[]>("GET", "/internal/admin/categories");
  }

  public async createCategory(input: CatalogCategoryInput): Promise<CatalogCategory> {
    return this.adminRequest<CatalogCategory>("POST", "/internal/admin/categories", input);
  }

  public async updateCategory(
    categoryId: string,
    input: CatalogCategoryInput,
  ): Promise<CatalogCategory> {
    return this.adminRequest<CatalogCategory>(
      "PATCH",
      `/internal/admin/categories/${encodeURIComponent(categoryId)}`,
      input,
    );
  }

  public async deleteCategory(categoryId: string): Promise<{ deleted: true }> {
    return this.adminRequest<{ deleted: true }>(
      "DELETE",
      `/internal/admin/categories/${encodeURIComponent(categoryId)}`,
    );
  }

  public async listPromotions(): Promise<CatalogPromotion[]> {
    return this.adminRequest<CatalogPromotion[]>("GET", "/internal/admin/promotions");
  }

  public async createPromotion(input: CatalogPromotionInput): Promise<CatalogPromotion> {
    return this.adminRequest<CatalogPromotion>("POST", "/internal/admin/promotions", input);
  }

  public async updatePromotion(
    promotionId: string,
    input: CatalogPromotionInput,
  ): Promise<CatalogPromotion> {
    return this.adminRequest<CatalogPromotion>(
      "PATCH",
      `/internal/admin/promotions/${encodeURIComponent(promotionId)}`,
      input,
    );
  }

  public async deletePromotion(promotionId: string): Promise<{ deleted: true }> {
    return this.adminRequest<{ deleted: true }>(
      "DELETE",
      `/internal/admin/promotions/${encodeURIComponent(promotionId)}`,
    );
  }

  public async listAdminAnnouncements(): Promise<CatalogAnnouncement[]> {
    return this.adminRequest<CatalogAnnouncement[]>("GET", "/internal/admin/announcements");
  }

  public async createAnnouncement(
    input: CatalogAnnouncementInput,
  ): Promise<CatalogAnnouncement> {
    return this.adminRequest<CatalogAnnouncement>(
      "POST",
      "/internal/admin/announcements",
      input,
    );
  }

  public async updateAnnouncement(
    announcementId: string,
    input: CatalogAnnouncementInput,
  ): Promise<CatalogAnnouncement> {
    return this.adminRequest<CatalogAnnouncement>(
      "PATCH",
      `/internal/admin/announcements/${encodeURIComponent(announcementId)}`,
      input,
    );
  }

  public async deleteAnnouncement(announcementId: string): Promise<{ deleted: true }> {
    return this.adminRequest<{ deleted: true }>(
      "DELETE",
      `/internal/admin/announcements/${encodeURIComponent(announcementId)}`,
    );
  }

  public async createProduct(input: CatalogProductInput): Promise<GatewayProduct> {
    return this.adminRequest<GatewayProduct>("POST", "/internal/admin/products", input);
  }

  public async updateProduct(
    productId: string,
    input: CatalogProductInput,
  ): Promise<GatewayProduct> {
    return this.adminRequest<GatewayProduct>(
      "PATCH",
      `/internal/admin/products/${encodeURIComponent(productId)}`,
      input,
    );
  }

  public async deleteProduct(
    productId: string,
    confirmRelatedDataDeletion: boolean,
  ): Promise<CatalogProductDeletionResult> {
    return this.adminRequest<CatalogProductDeletionResult>(
      "DELETE",
      `/internal/admin/products/${encodeURIComponent(productId)}`,
      { confirmRelatedDataDeletion },
    );
  }

  public async receiveStock(
    adminCustomerId: string,
    idempotencyKey: string,
    reason: string,
    lines: StockReceiptLineInput[],
  ): Promise<StockReceiptResult> {
    return this.adminRequest<StockReceiptResult>(
      "POST",
      "/internal/admin/stock-receipts",
      { adminCustomerId, reason, lines },
      idempotencyKey,
    );
  }

  private async adminRequest<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const token = process.env.CATALOG_INVENTORY_COMMAND_TOKEN?.trim();
    if (!token || token.length < 32) {
      throw new ServiceUnavailableException("Catalog administration is not configured");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }

    if (response.status === 400) {
      throw new BadRequestException("Catalog request was rejected");
    }
    if (response.status === 404) {
      throw new NotFoundException("Catalog resource was not found");
    }
    if (response.status === 409) {
      try {
        const payload: unknown = await response.json();
        if (
          typeof payload === "object" &&
          payload !== null &&
          "code" in payload &&
          payload.code === "PRODUCT_HAS_RELATED_DATA"
        ) {
          throw new ConflictException(payload);
        }
      } catch (error) {
        if (error instanceof ConflictException) throw error;
      }
      throw new ConflictException("Catalog resource conflicts with current data");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Catalog service is unavailable");
    }
    const payload = (await response.json()) as { data: T };
    return payload.data;
  }
}
