import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

export type GatewayProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

type CatalogResponse = { data: GatewayProduct[] };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

@Injectable()
export class CatalogClient {
  private readonly baseUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020";
  private readonly fetcher: FetchLike;

  public constructor(@Inject("CATALOG_FETCH") fetcher: FetchLike = fetch) {
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
}
