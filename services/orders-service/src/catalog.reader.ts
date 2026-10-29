export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

export interface CatalogReader {
  listActiveProducts(): Promise<CatalogProduct[]>;
}

type CatalogResponse = { data: CatalogProduct[] };

export class CatalogUnavailableError extends Error {
  public constructor() {
    super("Catalog service is unavailable");
    this.name = "CatalogUnavailableError";
  }
}

export class HttpCatalogReader implements CatalogReader {
  public constructor(
    private readonly fetcher: typeof fetch,
    private readonly baseUrl: string,
  ) {}

  public async listActiveProducts(): Promise<CatalogProduct[]> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/products`, {
        signal: AbortSignal.timeout(3_000),
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new CatalogUnavailableError();
      }

      const payload = (await response.json()) as CatalogResponse;
      return payload.data;
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw error;
      }

      throw new CatalogUnavailableError();
    }
  }
}
