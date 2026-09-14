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
  private readonly products: Product[] = [
    {
      id: "prod-mug-001",
      sku: "MILE-MUG-001",
      name: "Taza de cerámica",
      description: "Una taza sencilla para empezar bien el día.",
      priceCop: 28000,
      stock: 24,
    },
    {
      id: "prod-bag-001",
      sku: "MILE-BAG-001",
      name: "Bolso de lona",
      description: "Ligero, resistente y listo para acompañarte.",
      priceCop: 76000,
      stock: 12,
    },
    {
      id: "prod-note-001",
      sku: "MILE-NOTE-001",
      name: "Cuaderno de notas",
      description: "Papel de calidad para ideas y planes.",
      priceCop: 19000,
      stock: 38,
    },
    {
      id: "prod-bottle-001",
      sku: "MILE-BTL-001",
      name: "Botella térmica",
      description: "Mantén tus bebidas a temperatura ideal durante todo el día.",
      priceCop: 52000,
      stock: 17,
    },
  ];

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
