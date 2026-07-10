/** Stable mock sold count per product — avoids random values changing on every refresh. */
import { normalizeProductSpecifications } from "./productDescriptionDisplay";

export function stableVendorStorefrontSoldCount(product: {
  id?: string;
  sku?: string;
  salesVolume?: number;
}): number {
  const fromProduct = Number(product.salesVolume);
  if (Number.isFinite(fromProduct) && fromProduct > 0) {
    return Math.floor(fromProduct);
  }
  const seed = String(product.id ?? product.sku ?? "");
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (hash % 90) + 10;
}

export const VENDOR_STOREFRONT_MOCK_RATING = 4.8;

export function normalizeVendorStorefrontProduct<T extends { id?: string; sku?: string; rating?: number; reviewCount?: number; salesVolume?: number; specifications?: unknown }>(
  product: T
): T {
  return {
    ...product,
    specifications: normalizeProductSpecifications(product.specifications),
    rating: VENDOR_STOREFRONT_MOCK_RATING,
    reviewCount: stableVendorStorefrontSoldCount(product),
  };
}

export function normalizeVendorStorefrontProducts<T extends { id?: string; sku?: string; rating?: number; reviewCount?: number; salesVolume?: number; specifications?: unknown }>(
  products: T[]
): T[] {
  return products.map(normalizeVendorStorefrontProduct);
}
