export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

export type CatalogReservation = {
  orderId: string;
  status: "RESERVED" | "ACTIVE" | "COMMITTED" | "RELEASED";
  reservedAt: string;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCop: number;
  }>;
};

export interface CatalogReader {
  listActiveProducts(): Promise<CatalogProduct[]>;
  reserveProducts?(
    orderId: string,
    lines: Array<{ productId: string; quantity: number }>,
  ): Promise<CatalogReservation>;
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
  ): Promise<CatalogReservation> {
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
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null
      ) {
        throw new CatalogUnavailableError();
      }
      const reservation = payload.data;
      if (
        !("orderId" in reservation) ||
        reservation.orderId !== orderId ||
        !("status" in reservation) ||
        (reservation.status !== "RESERVED" &&
          reservation.status !== "ACTIVE" &&
          reservation.status !== "COMMITTED" &&
          reservation.status !== "RELEASED") ||
        !("reservedAt" in reservation) ||
        typeof reservation.reservedAt !== "string" ||
        !("lines" in reservation) ||
        !Array.isArray(reservation.lines)
      ) {
        throw new CatalogUnavailableError();
      }
      const reservedLines = reservation.lines;
      const requestedQuantities = new Map<string, number>();
      for (const line of lines) {
        requestedQuantities.set(
          line.productId,
          (requestedQuantities.get(line.productId) ?? 0) + line.quantity,
        );
      }
      if (
        reservedLines.length !== requestedQuantities.size ||
        !reservedLines.every(
          (line): line is CatalogReservation["lines"][number] =>
            typeof line === "object" &&
            line !== null &&
            "productId" in line &&
            typeof line.productId === "string" &&
            "sku" in line &&
            typeof line.sku === "string" &&
            "name" in line &&
            typeof line.name === "string" &&
            "quantity" in line &&
            Number.isSafeInteger(line.quantity) &&
            "unitPriceCop" in line &&
            Number.isSafeInteger(line.unitPriceCop) &&
            line.unitPriceCop >= 0,
        ) ||
        reservedLines.some(
          (line) => requestedQuantities.get(line.productId) !== line.quantity,
        )
      ) {
        throw new CatalogUnavailableError();
      }
      return {
        orderId: reservation.orderId,
        status: reservation.status,
        reservedAt: reservation.reservedAt,
        lines: reservedLines,
      };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw error;
      }
      throw new CatalogUnavailableError();
    }
  }
}
