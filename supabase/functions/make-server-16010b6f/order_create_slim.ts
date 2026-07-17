/** Strip checkout-only KBZPay QR blobs before persisting orders (CloudBase payload limits). */

function slimMediaRef(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  if (!s) return undefined;
  if (s.startsWith("data:")) return undefined;
  if (s.length > 2048) return s.slice(0, 2048);
  return s;
}

export function slimOrderCreateBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  if (out.kpay && typeof out.kpay === "object") {
    const k = out.kpay as Record<string, unknown>;
    const slimKpay: Record<string, unknown> = {};
    for (const key of [
      "merchantOrderId",
      "method",
      "prepayId",
      "status",
      "providerStatus",
    ]) {
      const v = k[key];
      if (v != null && String(v).trim() !== "") slimKpay[key] = v;
    }
    if (k.refund && typeof k.refund === "object") slimKpay.refund = k.refund;
    out.kpay = slimKpay;
  }

  if (Array.isArray(out.items)) {
    out.items = out.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const row = { ...(item as Record<string, unknown>) };
      const image = slimMediaRef(row.image);
      if (image) row.image = image;
      else delete row.image;
      return row;
    });
  }

  for (const key of ["deliveryServiceLogo"]) {
    if (typeof out[key] === "string" && String(out[key]).startsWith("data:")) {
      delete out[key];
    }
  }

  return out;
}
