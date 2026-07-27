export type FreeShippingLineItem = {
  freeShipping?: boolean;
};

/** True when super admin enabled free-shipping access for this vendor. */
export function vendorHasFreeShippingAccess(vendor: { freeShippingEnabled?: boolean } | null | undefined): boolean {
  return vendor?.freeShippingEnabled === true;
}

/** Resolve whether a product is marked free shipping for a specific vendor. */
export function resolveProductFreeShippingForVendor(
  product: { vendorFreeShipping?: Record<string, boolean> } | null | undefined,
  vendorId: string | null | undefined,
  vendorFreeShippingEnabled?: boolean,
  vendorAliases: string[] = []
): boolean {
  if (!vendorFreeShippingEnabled || !vendorId) return false;
  const map = product?.vendorFreeShipping;
  if (!map || typeof map !== "object") return false;
  const tokens = new Set<string>();
  for (const value of [vendorId, ...vendorAliases]) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    tokens.add(raw);
    tokens.add(raw.toLowerCase());
  }
  for (const [key, enabled] of Object.entries(map)) {
    if (enabled !== true) continue;
    const raw = String(key || "").trim();
    if (!raw) continue;
    if (tokens.has(raw) || tokens.has(raw.toLowerCase())) return true;
  }
  return false;
}

/** Shipping is free when every checkout line item is marked free shipping. */
export function checkoutQualifiesForFreeShipping(items: FreeShippingLineItem[]): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((item) => item.freeShipping === true);
}

/** Apply product-level free shipping override on top of the logistics quote. */
export function resolveEffectiveCheckoutShippingFee(args: {
  quotedFee: number;
  checkoutItems: FreeShippingLineItem[];
}): number {
  const quoted = Math.max(Number(args.quotedFee) || 0, 0);
  if (checkoutQualifiesForFreeShipping(args.checkoutItems)) return 0;
  return quoted;
}

export type CategoryFreeShippingRow = {
  id: string;
  name: string;
  productIds: string[];
  freeShippingEnabledCount: number;
  freeShippingTotalCount: number;
};

/** Recompute category free-shipping counts from current product flags. */
export function syncCategoryFreeShippingCounts<T extends CategoryFreeShippingRow>(
  categories: T[],
  products: ReadonlyArray<{ id: string; freeShipping?: boolean }>
): T[] {
  const freeById = new Map(products.map((product) => [product.id, product.freeShipping === true]));
  return categories.map((category) => {
    const total = category.productIds.length;
    const enabled = category.productIds.filter((id) => freeById.get(id)).length;
    return {
      ...category,
      freeShippingEnabledCount: enabled,
      freeShippingTotalCount: total,
    };
  });
}

export function mapCategoryFreeShippingRows(
  categories: ReadonlyArray<{
    id?: string;
    name?: string;
    productIds?: unknown[];
    freeShippingEnabledCount?: number;
    freeShippingTotalCount?: number;
  }>
): CategoryFreeShippingRow[] {
  return categories
    .map((cat) => {
      const productIds = Array.isArray(cat?.productIds)
        ? cat.productIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      return {
        id: String(cat?.id || ""),
        name: String(cat?.name || ""),
        productIds,
        freeShippingEnabledCount: Number(cat?.freeShippingEnabledCount ?? 0),
        freeShippingTotalCount: Number(cat?.freeShippingTotalCount ?? productIds.length),
      };
    })
    .filter((cat) => cat.id && cat.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** When category free shipping is partial, next toggle clears all; otherwise follow switch state. */
export function resolveCategoryFreeShippingToggleTarget(
  category: Pick<CategoryFreeShippingRow, "freeShippingEnabledCount" | "freeShippingTotalCount" | "productIds">,
  checked: boolean
): boolean {
  const total = category.freeShippingTotalCount || category.productIds.length;
  const enabled = category.freeShippingEnabledCount ?? 0;
  const isPartial = total > 0 && enabled > 0 && enabled < total;
  if (isPartial) return false;
  return checked;
}
