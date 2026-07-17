/** Drop bulky checkout-only fields before POST /orders (CloudBase payload limits). */

function slimMediaRef(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  if (!s) return undefined;
  if (s.startsWith("data:")) return undefined;
  if (s.length > 2048) return s.slice(0, 2048);
  return s;
}

export function slimKpayForOrderPersistence(
  kpay: unknown,
): Record<string, unknown> | undefined {
  if (!kpay || typeof kpay !== "object") return undefined;
  const src = kpay as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "merchantOrderId",
    "method",
    "prepayId",
    "status",
    "providerStatus",
  ] as const) {
    const v = src[key];
    if (v != null && String(v).trim() !== "") out[key] = v;
  }
  if (src.refund && typeof src.refund === "object") {
    out.refund = src.refund;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function slimOrderLineItemsForCreate(items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = { ...(item as Record<string, unknown>) };
    const image = slimMediaRef(row.image);
    if (image) row.image = image;
    else delete row.image;
    return row;
  });
}

export function slimOrderCreatePayload<T extends Record<string, unknown>>(body: T): T {
  const next = { ...body } as T & Record<string, unknown>;
  if (Array.isArray(next.items)) {
    next.items = slimOrderLineItemsForCreate(next.items) as T["items"];
  }
  if (next.kpay != null) {
    const kpay = slimKpayForOrderPersistence(next.kpay);
    if (kpay) next.kpay = kpay as T["kpay"];
    else delete next.kpay;
  }
  for (const key of ["deliveryServiceLogo"] as const) {
    if (typeof next[key] === "string" && String(next[key]).startsWith("data:")) {
      delete next[key];
    }
  }
  return next as T;
}
