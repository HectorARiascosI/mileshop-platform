export type SearchableProduct = {
  name: string;
  sku: string;
  description: string;
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
): T[] {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (!normalizedQuery) {
    return [...products];
  }

  return products.filter((product) =>
    normalizeSearchText(`${product.name} ${product.sku} ${product.description}`).includes(
      normalizedQuery,
    ),
  );
}
