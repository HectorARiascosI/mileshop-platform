import type { CatalogCategorySummary } from "@mileshop/contracts";

export type SearchableProduct = {
  name: string;
  sku: string;
  description: string;
  categoryId?: string | null;
  category?: CatalogCategorySummary | null;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO");
}

export function filterCatalogProducts<T extends SearchableProduct>(
  products: readonly T[],
  query: string,
  categoryId: string | null = null,
): T[] {
  const normalizedQuery = normalizeSearchText(query.trim());
  return products.filter((product) =>
    (categoryId === null || (product.category?.id ?? product.categoryId) === categoryId) &&
    (!normalizedQuery ||
      normalizeSearchText(
        `${product.name} ${product.sku} ${product.description} ${product.category?.name ?? ""}`,
      ).includes(normalizedQuery)),
  );
}
