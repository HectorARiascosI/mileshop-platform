export const CATALOG_CATEGORY_THEMES = [
  "neutral",
  "gold",
  "blue",
  "fuchsia",
  "wood",
] as const;

export type CatalogCategoryTheme = (typeof CATALOG_CATEGORY_THEMES)[number];

export type CatalogCategorySummary = {
  id: string;
  name: string;
  slug: string;
  theme: CatalogCategoryTheme;
};

export type CatalogCategory = CatalogCategorySummary & {
  productCount: number;
};

export type CatalogCategoryInput = {
  name: string;
  theme: CatalogCategoryTheme;
};

export const CATALOG_PRODUCT_IMAGE_LIMIT = 8;
export const DELIVERY_FEE_THRESHOLD_COP = 12_000;
export const DELIVERY_FEE_COP = 7_000;

export type CatalogProductImageInput = {
  imageUrl: string;
  imageFileId?: string | null;
};

export type CatalogProductImage = CatalogProductImageInput & {
  position: number;
};

export type CatalogProductImageSummary = {
  imageUrl: string;
  position: number;
};

export type CatalogProductPromotion = {
  id: string;
  title: string;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
};

export type CatalogPromotionProductInput = {
  productId: string;
  discountPercent: number;
};

export type CatalogPromotionInput = {
  title: string;
  description: string;
  imageUrl?: string | null;
  imageFileId?: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  products: CatalogPromotionProductInput[];
};

export type CatalogPromotion = Omit<CatalogPromotionInput, "products"> & {
  id: string;
  products: Array<CatalogPromotionProductInput & {
    name: string;
    sku: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type CatalogAnnouncementInput = {
  title: string;
  message: string;
  imageUrl?: string | null;
  imageFileId?: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

export type CatalogAnnouncement = CatalogAnnouncementInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderCreatedV1 = {
  eventType: "OrderCreated.v1";
  eventId: string;
  occurredAt: string;
  aggregateId: string;
  payload: {
    customerId: string;
    subtotalCop?: number;
    deliveryFeeCop?: number;
    totalCop: number;
    currency: "COP";
    lines: Array<{
      productId: string;
      sku: string;
      name: string;
      quantity: number;
      unitPriceCop: number;
    }>;
  };
};
