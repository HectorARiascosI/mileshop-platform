import { CATALOG_CATEGORY_THEMES } from "@mileshop/contracts";
import type {
  CatalogCategory,
  CatalogCategorySummary,
  CatalogCategoryTheme,
} from "@mileshop/contracts";

export const CATEGORY_THEME_LABELS: Record<CatalogCategoryTheme, string> = {
  neutral: "Neutro",
  gold: "Dorado",
  blue: "Azul",
  fuchsia: "Fucsia",
  wood: "Madera",
};

export function isCatalogCategoryTheme(value: unknown): value is CatalogCategoryTheme {
  return typeof value === "string" && CATALOG_CATEGORY_THEMES.some((theme) => theme === value);
}

export function isCatalogCategorySummary(value: unknown): value is CatalogCategorySummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "slug" in value &&
    typeof value.slug === "string" &&
    "theme" in value &&
    isCatalogCategoryTheme(value.theme)
  );
}

export function isCatalogCategory(value: unknown): value is CatalogCategory {
  return (
    isCatalogCategorySummary(value) &&
    "productCount" in value &&
    typeof value.productCount === "number" &&
    Number.isSafeInteger(value.productCount) &&
    value.productCount >= 0
  );
}
