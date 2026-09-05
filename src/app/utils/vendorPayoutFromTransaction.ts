/**
 * Vendor payout for Finances cards: product line net minus platform commission.
 * Shipping must never be included (order total − commission is the stale formula).
 */
import { orderLineGross, orderLineNetAfterDiscount } from "./vendorCommissionEarned";

function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function transactionLineItems(txn: Record<string, unknown>): unknown[] {
  if (Array.isArray(txn.products)) return txn.products;
  if (Array.isArray(txn.items)) return txn.items;
  return [];
}

export function productLineNetFromFinancesTransaction(txn: Record<string, unknown>): number | null {
  const items = transactionLineItems(txn);
  if (items.length === 0) return null;
  const orderLike = {
    subtotal: txn.subtotal != null && txn.subtotal !== "" ? parseMoney(txn.subtotal) : 0,
    discount: parseMoney(txn.discount),
  };
  if (!(orderLike.subtotal > 0)) {
    orderLike.subtotal = items.reduce((sum, item) => sum + orderLineGross(item), 0);
  }
  let net = 0;
  for (const item of items) {
    net += orderLineNetAfterDiscount(orderLineGross(item), orderLike);
  }
  return Math.round(net * 100) / 100;
}

/** Vendor net from product lines only — excludes shipping. */
export function vendorPayoutExcludingShipping(txn: Record<string, unknown>): number {
  const commission = parseMoney(txn.commission);
  const productNet = productLineNetFromFinancesTransaction(txn);
  if (productNet != null) {
    return Math.max(0, Math.round((productNet - commission) * 100) / 100);
  }
  return Math.max(0, parseMoney(txn.vendorPayout));
}

/**
 * Platform commission on product value only (never shipping).
 * Prefer productNet − vendor payout so the chart matches the Commission Payout card.
 */
export function platformCommissionExcludingShipping(txn: Record<string, unknown>): number {
  const productNet = productLineNetFromFinancesTransaction(txn);
  if (productNet != null) {
    const payout = vendorPayoutExcludingShipping(txn);
    return Math.max(0, Math.round((productNet - payout) * 100) / 100);
  }
  return Math.max(0, parseMoney(txn.commission));
}
