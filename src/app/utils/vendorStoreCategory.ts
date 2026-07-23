/** URL segment for vendor storefront "no category" tab. */
export const VENDOR_STORE_UNCATEGORIZED_SLUG = "uncategorized";

/** Internal filter token (API + module cache keys) — not a product.category value. */
export const VENDOR_STORE_UNCATEGORIZED_FILTER = "__uncategorized__";

export type VendorCategoryRouteItem = {
  id?: string;
  name: string;
};

export function isVendorUncategorizedSlug(slug: string): boolean {
  return String(slug || "").trim().toLowerCase() === VENDOR_STORE_UNCATEGORIZED_SLUG;
}

export function isVendorUncategorizedFilter(category: string): boolean {
  const c = String(category || "").trim();
  return c === VENDOR_STORE_UNCATEGORIZED_FILTER || isVendorUncategorizedSlug(c);
}

export function productHasNoCategory(product: { category?: string | null }): boolean {
  const raw = String(product?.category ?? "").trim();
  if (!raw) return true;
  return raw.toLowerCase() === VENDOR_STORE_UNCATEGORIZED_SLUG;
}

function safeDecodePathSegment(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/** Lowercase route segment after URI decode — preserves Burmese and `c-{id}` slugs. */
export function normalizeCategoryRouteSlug(raw: string): string {
  return String(safeDecodePathSegment(raw) || "").trim().toLowerCase();
}

export function slugifyCategoryName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function categoryIdUrlTail(categoryId: string): string {
  const parts = String(categoryId || "").split(":");
  return parts[parts.length - 1]?.trim() || "";
}

/** Stable URL path segment for a vendor category tab. */
export function vendorCategoryUrlSlug(category: VendorCategoryRouteItem): string {
  const raw = String(category.name || "").trim();
  if (!raw || raw.toLowerCase() === "all") return "";
  if (isVendorUncategorizedFilter(raw)) return VENDOR_STORE_UNCATEGORIZED_SLUG;

  const asciiSlug = slugifyCategoryName(raw);
  if (asciiSlug) return asciiSlug;

  const idTail = categoryIdUrlTail(String(category.id || ""));
  if (idTail) return `c-${idTail}`;

  return encodeURIComponent(raw);
}

export function vendorCategoryPathSegment(categoryName: string, categoryId?: string): string {
  return vendorCategoryUrlSlug({ name: categoryName, id: categoryId });
}

export function categoryRouteSlugMatches(
  routeSlug: string,
  category: VendorCategoryRouteItem
): boolean {
  const normRoute = normalizeCategoryRouteSlug(routeSlug);
  if (!normRoute) return false;

  const expected = vendorCategoryUrlSlug(category);
  if (!expected) return false;

  if (normRoute === expected.toLowerCase()) return true;

  const decodedRoute = String(safeDecodePathSegment(routeSlug) || "").trim();
  return decodedRoute === String(category.name || "").trim();
}

/** Map route slug → catalog filter param (display name or uncategorized token). */
export function vendorCatalogFilterFromRouteSlug(
  routeSlug: string,
  subnavItems: VendorCategoryRouteItem[]
): string {
  const norm = normalizeCategoryRouteSlug(routeSlug);
  if (!norm) return "all";
  if (isVendorUncategorizedSlug(norm)) return VENDOR_STORE_UNCATEGORIZED_FILTER;

  const match = subnavItems.find((c) => categoryRouteSlugMatches(routeSlug, c));
  if (match) return match.name;

  const decoded = String(safeDecodePathSegment(routeSlug) || "").trim();
  if (decoded) return decoded;

  return humanizeCategorySlug(routeSlug);
}

function humanizeCategorySlug(slug: string): string {
  return String(slug || "")
    .trim()
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function isVendorCategoryTabActive(
  tab: "all" | "uncategorized" | VendorCategoryRouteItem,
  routeSlug: string
): boolean {
  const norm = normalizeCategoryRouteSlug(routeSlug);
  if (tab === "all") return !norm;
  if (tab === "uncategorized") return isVendorUncategorizedSlug(norm);
  return categoryRouteSlugMatches(routeSlug, tab);
}
