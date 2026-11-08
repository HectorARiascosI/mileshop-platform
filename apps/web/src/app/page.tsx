import { CatalogShell } from "@/components/catalog-shell";
import { fetchApiGateway, getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import type {
  CatalogAnnouncement,
  CatalogCategorySummary,
  CatalogProductImageSummary,
  CatalogPromotion,
  CatalogProductPromotion,
} from "@mileshop/contracts";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  priceBeforeDiscountCop?: number;
  promotion?: CatalogProductPromotion | null;
  stock: number;
  imageUrl?: string | null;
  images?: CatalogProductImageSummary[];
  category?: CatalogCategorySummary | null;
};

type CatalogResult = {
  products: Product[];
  unavailable: boolean;
};

function isCatalogAnnouncement(value: unknown): value is CatalogAnnouncement {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "message" in value &&
    typeof value.message === "string" &&
    "linkUrl" in value &&
    (typeof value.linkUrl === "string" || value.linkUrl === null) &&
    "linkLabel" in value &&
    (typeof value.linkLabel === "string" || value.linkLabel === null) &&
    "startsAt" in value &&
    typeof value.startsAt === "string" &&
    "endsAt" in value &&
    typeof value.endsAt === "string" &&
    "isActive" in value &&
    typeof value.isActive === "boolean" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    (!("imageUrl" in value) || typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (!("imageFileId" in value) || typeof value.imageFileId === "string" || value.imageFileId === null)
  );
}

function isCatalogPromotion(value: unknown): value is CatalogPromotion {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "startsAt" in value &&
    typeof value.startsAt === "string" &&
    "endsAt" in value &&
    typeof value.endsAt === "string" &&
    "isActive" in value &&
    typeof value.isActive === "boolean" &&
    "products" in value &&
    Array.isArray(value.products) &&
    value.products.every((product) =>
      typeof product === "object" &&
      product !== null &&
      "productId" in product &&
      typeof product.productId === "string" &&
      "discountPercent" in product &&
      Number.isSafeInteger(product.discountPercent) &&
      "name" in product &&
      typeof product.name === "string" &&
      "sku" in product &&
      typeof product.sku === "string",
    ) &&
    (!("imageUrl" in value) || typeof value.imageUrl === "string" || value.imageUrl === null) &&
    (!("imageFileId" in value) || typeof value.imageFileId === "string" || value.imageFileId === null)
  );
}

async function getCatalog(): Promise<CatalogResult> {
  const endpoint = getApiGatewayEndpoint("/catalog/products");
  if (!endpoint) {
    return { products: [], unavailable: true };
  }

  try {
    const response = await fetchApiGateway(endpoint, { cache: "no-store" });

    if (!response.ok) {
      return { products: [], unavailable: true };
    }

    const payload = (await response.json()) as { data: Product[] };
    return { products: payload.data, unavailable: false };
  } catch {
    return { products: [], unavailable: true };
  }
}

async function getAnnouncements(): Promise<CatalogAnnouncement[]> {
  const endpoint = getApiGatewayEndpoint("/catalog/announcements");
  if (!endpoint) return [];
  try {
    const response = await fetchApiGateway(endpoint, { cache: "no-store" });
    if (response.status === 404) return [];
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload) ||
      !Array.isArray(payload.data)
    ) throw new Error("Announcement response shape is invalid");
    const announcements = payload.data.filter(isCatalogAnnouncement);
    if (announcements.length !== payload.data.length) {
      throw new Error("Announcement response contains invalid items");
    }
    return announcements;
  } catch (error) {
    console.error("Could not load active MileShop announcements", error);
    return [];
  }
}

async function getPromotions(): Promise<CatalogPromotion[]> {
  const endpoint = getApiGatewayEndpoint("/catalog/promotions");
  if (!endpoint) return [];
  try {
    const response = await fetchApiGateway(endpoint, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Promotion service returned ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload) ||
      !Array.isArray(payload.data)
    ) {
      throw new Error("Promotion response shape is invalid");
    }
    const promotions = payload.data.filter(isCatalogPromotion);
    if (promotions.length !== payload.data.length) {
      throw new Error("Promotion response contains invalid items");
    }
    return promotions;
  } catch (error) {
    console.error("Could not load active MileShop promotions", error);
    return [];
  }
}

export default async function Home() {
  const [{ products, unavailable }, announcements, promotions] = await Promise.all([
    getCatalog(),
    getAnnouncements(),
    getPromotions(),
  ]);

  return (
    <CatalogShell
      products={products}
      unavailable={unavailable}
      announcements={announcements}
      promotions={promotions}
    />
  );
}
