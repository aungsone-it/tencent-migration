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
  vendorFreeShippingEnabled?: boolean
): boolean {
  if (!vendorFreeShippingEnabled || !vendorId) return false;
  const map = product?.vendorFreeShipping;
  if (!map || typeof map !== "object") return false;
  return map[String(vendorId).trim()] === true;
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
