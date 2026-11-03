import { CatalogShell } from "@/components/catalog-shell";
import { fetchApiGateway, getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import type {
  CatalogAnnouncement,
  CatalogCategorySummary,
  CatalogProductImageSummary,
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
    typeof value.updatedAt === "string"
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

export default async function Home() {
  const [{ products, unavailable }, announcements] = await Promise.all([
    getCatalog(),
    getAnnouncements(),
  ]);

  return <CatalogShell products={products} unavailable={unavailable} announcements={announcements} />;
}
