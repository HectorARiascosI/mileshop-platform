import { PrismaClient } from "../generated/catalog-client/index.js";

import type { CatalogStore, Product } from "./catalog.service.js";

export class PrismaCatalogStore implements CatalogStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listActiveProducts(): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        priceCop: true,
        stock: true,
      },
    });
  }
}
