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
  reserveProducts?(orderId: string, lines: Array<{ productId: string; quantity: number }>): Promise<unknown>;
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
    private readonly reservationToken?: string,
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

  public async reserveProducts(
    orderId: string,
    lines: Array<{ productId: string; quantity: number }>,
  ): Promise<unknown> {
    if (!this.reservationToken) {
      throw new CatalogUnavailableError();
    }
    try {
      const response = await this.fetcher(`${this.baseUrl}/internal/reservations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-catalog-reservation-token": this.reservationToken,
        },
        body: JSON.stringify({ orderId, lines }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        throw new CatalogUnavailableError();
      }
      return await response.json();
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw error;
      }
      throw new CatalogUnavailableError();
    }
  }
}
