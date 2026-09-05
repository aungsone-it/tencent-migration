/** Correct vendor payout on finances transactions: product lines minus commission, never order total. */

function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function lineGross(item: Record<string, unknown>): number {
  if (item.subtotal != null && item.subtotal !== "") return parseMoney(item.subtotal);
  if (item.total != null && item.total !== "") return parseMoney(item.total);
  const qty = Math.max(1, parseMoney(item.quantity) || 1);
  return parseMoney(item.price ?? (item.product as Record<string, unknown> | undefined)?.price) * qty;
}

function productLineNet(txn: Record<string, unknown>): number | null {
  const items = Array.isArray(txn.products)
    ? txn.products
    : Array.isArray(txn.items)
      ? txn.items
      : [];
  if (items.length === 0) return null;
  let sum = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    sum += lineGross(item as Record<string, unknown>);
  }
  return Math.round(sum * 100) / 100;
}

export function vendorPayoutExcludingShipping(txn: Record<string, unknown>): number {
  const commission = parseMoney(txn.commission);
  const productNet = productLineNet(txn);
  if (productNet != null) {
    return Math.max(0, Math.round((productNet - commission) * 100) / 100);
  }
  return Math.max(0, parseMoney(txn.vendorPayout));
}

export function correctFinancesAnalyticsVendorPayouts(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const transactions = Array.isArray(body.transactions) ? body.transactions : [];
  const corrected = transactions.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const txn = row as Record<string, unknown>;
    return { ...txn, vendorPayout: vendorPayoutExcludingShipping(txn) };
  });

  const summary =
    body.summary && typeof body.summary === "object" && !Array.isArray(body.summary)
      ? { ...(body.summary as Record<string, unknown>) }
      : {};

  let totalVendorPayout = 0;
  for (const row of corrected) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    totalVendorPayout += parseMoney((row as Record<string, unknown>).vendorPayout);
  }
  summary.totalVendorPayout = Math.round(totalVendorPayout * 100) / 100;

  return {
    ...body,
    summary,
    transactions: corrected,
  };
}
