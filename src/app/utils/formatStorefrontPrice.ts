/** Customer-facing storefront currency label (Myanmar kyat). */
export const STOREFRONT_CURRENCY_UNIT = "ကျပ်";

export function formatStorefrontPrice(price: string | number): string {
  const numPrice =
    typeof price === "string" ? parseFloat(price.replace(/[^0-9.-]+/g, "")) : price;
  const rounded = Math.round(Number.isFinite(numPrice) ? numPrice : 0);
  return `${rounded.toLocaleString()} ${STOREFRONT_CURRENCY_UNIT}`;
}
