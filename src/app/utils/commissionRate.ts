/**
 * Commission rate resolution — shared client copy of commission_rate.ts.
 * @see supabase/functions/make-server-16010b6f/commission_rate.ts
 */

export function parseCommissionPercent(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function explicitCommissionPercent(value: unknown): number | null {
  return parseCommissionPercent(value);
}

export function productHasExplicitCommissionRate(product: any): boolean {
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

export function lineSnapshotCommissionPercent(item: any): number | null {
  return explicitCommissionPercent(item?.commissionRate ?? item?.commission);
}

export function resolveLineCommissionPercent(
  item: any,
  productExplicitPercent: number | null,
  vendorContractPercent: number,
): number {
  const fromLine = lineSnapshotCommissionPercent(item);
  if (fromLine != null) return fromLine;
  if (productExplicitPercent != null) return productExplicitPercent;
  return defaultVendorCommissionPercent(vendorContractPercent);
}

export function resolveLineCommissionPercentFromProducts(
  item: any,
  products: any[],
  vendorContractPercent: number,
): number {
  const fromLine = lineSnapshotCommissionPercent(item);
  if (fromLine != null) return fromLine;

  const matched = products.find(
    (p: any) =>
      (item.sku && p.sku === item.sku) ||
      (item.productId != null && p.id != null && String(p.id) === String(item.productId)),
  );
  if (matched && productHasExplicitCommissionRate(matched)) {
    const fromProduct = explicitCommissionPercent(matched.commissionRate ?? matched.commission);
    if (fromProduct != null) return fromProduct;
  }

  return defaultVendorCommissionPercent(vendorContractPercent);
}
