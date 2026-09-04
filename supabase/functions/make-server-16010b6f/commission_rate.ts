/**
 * Commission rate resolution (canonical):
 * 1. Order line snapshot — set at checkout when product has an explicit rate
 * 2. Product rate — only when admin filled the product commission field (blank → skip)
 * 3. Vendor contract — super-admin default on the vendor record
 * 4. Platform default — 0%
 */

type AnyRecord = Record<string, unknown>;

export function parseCommissionPercent(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function explicitCommissionPercent(value: unknown): number | null {
  return parseCommissionPercent(value);
}

export function productHasExplicitCommissionRate(product: AnyRecord | null | undefined): boolean {
  return (
    product?.commissionRate !== undefined &&
    product?.commissionRate !== null &&
    String(product.commissionRate).trim() !== ""
  );
}

export function defaultVendorCommissionPercent(value: unknown): number {
  if (value == null || value === "") return 0;
  const parsed = explicitCommissionPercent(value);
  return parsed != null ? parsed : 0;
}

/** Line snapshot only — never read embedded product defaults here. */
export function lineSnapshotCommissionPercent(item: AnyRecord): number | null {
  return explicitCommissionPercent(item.commissionRate ?? item.commission);
}

export function resolveLineCommissionPercent(
  item: AnyRecord,
  productExplicitPercent: number | null,
  vendorContractPercent: number,
): number {
  const fromLine = lineSnapshotCommissionPercent(item);
  if (fromLine != null) return fromLine;
  if (productExplicitPercent != null) return productExplicitPercent;
  return defaultVendorCommissionPercent(vendorContractPercent);
}

export type ProductCommissionLookup = {
  commissionRate: unknown;
  hasExplicitRate: boolean;
};

export function productExplicitPercentFromLookup(
  lookup: ProductCommissionLookup | null | undefined,
): number | null {
  if (!lookup?.hasExplicitRate) return null;
  return explicitCommissionPercent(lookup.commissionRate);
}

export function buildProductCommissionLookup(
  product: AnyRecord,
): ProductCommissionLookup | null {
  if (product?.id == null || String(product.id).trim() === "") return null;
  const hasExplicitRate = productHasExplicitCommissionRate(product);
  return {
    commissionRate: hasExplicitRate ? product.commissionRate : null,
    hasExplicitRate,
  };
}

export function resolveLineCommissionPercentFromCatalog(
  item: AnyRecord,
  productMap: Map<string, ProductCommissionLookup>,
  vendorContractPercent: number,
): number {
  const fromLine = lineSnapshotCommissionPercent(item);
  if (fromLine != null) return fromLine;

  const keys: string[] = [];
  const rawPid = item.productId ?? item.id;
  if (rawPid != null) {
    const s = String(rawPid).trim();
    if (s) {
      keys.push(s);
      if (s.includes(":")) keys.push(s.split(":")[0]!.trim());
    }
  }
  const sku = item.sku != null ? String(item.sku).trim() : "";
  if (sku) keys.push(sku);

  for (const k of keys) {
    const fromProduct = productExplicitPercentFromLookup(productMap.get(k));
    if (fromProduct != null) return fromProduct;
  }

  return defaultVendorCommissionPercent(vendorContractPercent);
}
