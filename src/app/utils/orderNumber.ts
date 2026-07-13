export const ORDER_NUMBER_PREFIX = "MOS";
const LEGACY_ORDER_PREFIX = "ORD";
const ORDER_PREFIX_PATTERN = /^(ORD|MOS)-/i;

/** New storefront / KBZ merchant order ids: MOS-{code} */
export function buildOrderNumber(prefix = ORDER_NUMBER_PREFIX): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export function isPrefixedOrderNumber(value: string): boolean {
  return ORDER_PREFIX_PATTERN.test(value.trim());
}

/** Strip # and ORD-/MOS- prefix, returning the alphanumeric code only. */
export function extractOrderCode(orderNumber: string): string {
  return orderNumber.replace(/^#/, "").trim().toUpperCase().replace(ORDER_PREFIX_PATTERN, "");
}

/** UI + invoice: always show MOS-{code}, never ORD-. */
export function formatOrderNumberDisplay(orderNumber: string): string {
  const code = extractOrderCode(orderNumber);
  if (!code) return String(orderNumber || "").trim();
  return `${ORDER_NUMBER_PREFIX}-${code}`;
}

/** Invoice barcode label: MOS-{code} (e.g. MOS-MRFDNEWI). */
export function formatInvoiceBarcodeValue(orderNumber: string): string {
  return formatOrderNumberDisplay(orderNumber);
}

/** Search tokens for matching MOS display against legacy ORD storage. */
export function orderNumberSearchTokens(orderNumber: string): string[] {
  const raw = String(orderNumber || "").trim();
  if (!raw) return [];
  const code = extractOrderCode(raw);
  if (!code) return [raw.toLowerCase()];
  return [`ord-${code}`.toLowerCase(), `mos-${code}`.toLowerCase(), code.toLowerCase()];
}

/** True when query matches stored ORD- or display MOS- order numbers. */
export function orderNumberMatchesQuery(orderNumber: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = orderNumberSearchTokens(orderNumber);
  const needles = isPrefixedOrderNumber(q) ? orderNumberSearchTokens(q) : [q];
  return needles.some((needle) => hay.some((h) => h.includes(needle) || needle.includes(h)));
}

/** Normalize admin search input to MOS-/ORD- order id when applicable. */
export function normalizeOrderNumberSearch(query: string): string {
  const q = query.trim().toUpperCase();
  return isPrefixedOrderNumber(q) ? q : "";
}
