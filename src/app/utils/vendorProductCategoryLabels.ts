export function buildVendorProductCategoryLabels(
  categories: Array<{ name?: string; productIds?: string[] }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of categories) {
    const name = String(cat?.name || "").trim();
    if (!name) continue;
    for (const rawId of cat?.productIds || []) {
      const id = String(rawId || "").trim();
      if (!id) continue;
      const existing = map.get(id);
      map.set(id, existing ? `${existing}, ${name}` : name);
    }
  }
  return map;
}

export function resolveVendorProductCategoryLabel(
  productId: string,
  platformCategory: string | undefined,
  vendorCategoryByProductId: Map<string, string>,
  uncategorizedLabel = "Uncategorized",
): string {
  const fromVendor = vendorCategoryByProductId.get(productId);
  if (fromVendor) return fromVendor;
  const fromProduct = String(platformCategory || "").trim();
  if (fromProduct) return fromProduct;
  return uncategorizedLabel;
}

export function parseProductMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    return parseFloat(value.replace(/[$,]/g, "")) || 0;
  }
  return 0;
}
