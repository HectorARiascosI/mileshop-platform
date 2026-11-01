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
