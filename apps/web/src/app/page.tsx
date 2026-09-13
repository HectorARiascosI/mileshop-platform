import { CatalogShell } from "@/components/catalog-shell";

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
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

  try {
    const response = await fetch(`${gatewayUrl}/catalog/products`, {
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
