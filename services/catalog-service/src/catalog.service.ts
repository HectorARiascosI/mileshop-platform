import { Injectable } from "@nestjs/common";

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

export interface CatalogStore {
  listActiveProducts(): Promise<Product[]>;
}

@Injectable()
export class InMemoryCatalogStore implements CatalogStore {
  private readonly products: Product[] = [];

  public async listActiveProducts(): Promise<Product[]> {
    return this.products.map((product) => ({ ...product }));
  }
}

@Injectable()
export class CatalogService {
  public constructor(private readonly store: CatalogStore) {}

  public async listProducts(): Promise<Product[]> {
    return this.store.listActiveProducts();
  }
}
