import { CatalogShell } from "@/components/catalog-shell";
import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

type CatalogResult = {
  products: Product[];
  unavailable: boolean;
};

async function getCatalog(): Promise<CatalogResult> {
  const endpoint = getApiGatewayEndpoint("/catalog/products");
  if (!endpoint) {
    return { products: [], unavailable: true };
  }

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
    });

    if (!response.ok) {
      return { products: [], unavailable: true };
    }

    const payload = (await response.json()) as { data: Product[] };
    return { products: payload.data, unavailable: false };
  } catch {
    return { products: [], unavailable: true };
  }
}

export default async function Home() {
  const { products, unavailable } = await getCatalog();

  return <CatalogShell products={products} unavailable={unavailable} />;
}
