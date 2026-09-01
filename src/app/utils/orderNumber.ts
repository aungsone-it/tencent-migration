import { cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from "../../../utils/supabase/info";

export const ORDER_NUMBER_PREFIX = "NOS";
const LEGACY_ORDER_PREFIXES = ["ORD", "MOS", "NOS"] as const;
const ORDER_PREFIX_PATTERN = /^(ORD|MOS|NOS)-/i;

/** Format serial as NOS-00001, NOS-00002, NOS-100000, etc. */
export function formatSerialOrderNumber(serial: number, prefix = ORDER_NUMBER_PREFIX): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  const body = n < 100000 ? String(n).padStart(5, "0") : String(n);
  return `${prefix}-${body}`;
}

/** Allocate the next serial order number from the server (NOS-00001, NOS-00002, …). */
export async function fetchNextOrderNumber(timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${cloudbaseApiBaseUrl}/orders/next-number`, {
      signal: controller.signal,
      headers: {
        ...getCloudBaseRequestHeaders(),
        ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
      },
    });
    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      orderNumber?: string;
      error?: string;
      message?: string;
    };
    const orderNumber = String(data.orderNumber || "").trim();
    if (!response.ok || !orderNumber) {
      throw new Error(data.message || data.error || "Failed to allocate order number");
    }
    return orderNumber;
  } finally {
    clearTimeout(timer);
  }
}

/** Read order number from POST /orders response shapes (CloudBase + legacy). */
export function resolveCreatedOrderNumber(result: unknown, fallback = ""): string {
  if (!result || typeof result !== "object") return String(fallback || "").trim();
  const row = result as Record<string, unknown>;
  const nestedOrder =
    row.order && typeof row.order === "object" ? (row.order as Record<string, unknown>) : null;
  const nestedData =
    row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
  const nestedDataOrder =
    nestedData?.order && typeof nestedData.order === "object"
      ? (nestedData.order as Record<string, unknown>)
      : null;
  return String(
    row.orderNumber ??
      nestedOrder?.orderNumber ??
      nestedData?.orderNumber ??
      nestedDataOrder?.orderNumber ??
      fallback ??
      ""
  ).trim();
}

/** @deprecated Use fetchNextOrderNumber() for new orders. Kept for tests/fallback. */
export function buildOrderNumber(prefix = ORDER_NUMBER_PREFIX): string {
  return formatSerialOrderNumber(1, prefix);
}

export function isPrefixedOrderNumber(value: string): boolean {
  return ORDER_PREFIX_PATTERN.test(value.trim());
}

/** Strip # and ORD-/MOS-/NOS- prefix, returning the code or serial segment. */
export function extractOrderCode(orderNumber: string): string {
  const raw = orderNumber.replace(/^#/, "").trim().toUpperCase();
  const serialMatch = raw.match(/^(?:ORD|MOS|NOS)-(\d+)$/);
  if (serialMatch) return serialMatch[1];
  return raw.replace(ORDER_PREFIX_PATTERN, "");
}

/** UI + invoice display for order numbers. */
export function formatOrderNumberDisplay(orderNumber: string): string {
  let raw = String(orderNumber || "").trim().replace(/^#/, "");
  if (!raw) return "";

  // Unwrap stacked prefixes saved by legacy flows (e.g. MOS-NOS-00001 → NOS-00001).
  for (let pass = 0; pass < 3; pass++) {
    const stacked = raw.match(/^(?:ORD|MOS|NOS)-((?:NOS|MOS|ORD)-\d+)$/i);
    if (stacked) {
      raw = stacked[1];
      continue;
    }
    break;
  }

  const serialMatch = raw.match(/^(NOS|MOS|ORD)-(\d+)$/i);
  if (serialMatch) {
    return formatSerialOrderNumber(parseInt(serialMatch[2], 10));
  }
  return raw.toUpperCase();
}

/** Canonical order number before persisting (drops legacy MOS-/ORD- wrappers). */
export function canonicalizeOrderNumber(orderNumber: string): string {
  return formatOrderNumberDisplay(orderNumber);
}

/** Invoice barcode label uses the same display format. */
export function formatInvoiceBarcodeValue(orderNumber: string): string {
  return formatOrderNumberDisplay(orderNumber);
}

/** Search tokens for matching order numbers across legacy prefixes. */
export function orderNumberSearchTokens(orderNumber: string): string[] {
  const raw = String(orderNumber || "").trim();
  if (!raw) return [];
  const display = formatOrderNumberDisplay(raw);
  const code = extractOrderCode(raw);
  const tokens = new Set<string>([raw.toLowerCase(), display.toLowerCase()]);
  if (code) {
    for (const prefix of LEGACY_ORDER_PREFIXES) {
      tokens.add(`${prefix.toLowerCase()}-${code.toLowerCase()}`);
    }
  }
  return [...tokens];
}

/** True when query matches stored or display order numbers. */
export function orderNumberMatchesQuery(orderNumber: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = orderNumberSearchTokens(orderNumber);
  const needles = isPrefixedOrderNumber(q) ? orderNumberSearchTokens(q) : [q];
  return needles.some((needle) => hay.some((h) => h.includes(needle) || needle.includes(h)));
}

/** Normalize admin search input to prefixed order id when applicable. */
export function normalizeOrderNumberSearch(query: string): string {
  const q = query.trim().toUpperCase();
  return isPrefixedOrderNumber(q) ? q : "";
}
