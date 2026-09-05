/** Status helpers for super-admin Finances cards and transaction filters. */

import { vendorPayoutExcludingShipping } from "./vendorPayoutFromTransaction";

export function normalizeFinancesOrderStatus(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
}

/** Total Revenue card — exclude cancelled / canceled only. */
export function isCancelledFinancesOrder(raw: unknown): boolean {
  const status = normalizeFinancesOrderStatus(raw);
  return status === "cancelled" || status === "canceled";
}

/**
 * Revenue card — confirmed / in-fulfillment orders only (not pending checkout noise).
 * Includes ready-to-ship, fulfilled, shipped, and equivalent pipeline statuses.
 */
export function isAccruedFinancesOrder(raw: unknown): boolean {
  const status = normalizeFinancesOrderStatus(raw);
  if (!status || isCancelledFinancesOrder(status)) return false;
  return (
    status === "processing" ||
    status === "confirmed" ||
    status === "ready-to-ship" ||
    status === "readytoship" ||
    status === "fulfilled" ||
    status === "shipped" ||
    status === "in-transit" ||
    status === "shipping" ||
    status === "delivered" ||
    status === "completed" ||
    status === "complete"
  );
}

export function financesTransactionKey(raw: {
  id?: unknown;
  orderNumber?: unknown;
}): string {
  return String(raw.orderNumber || raw.id || "")
    .trim()
    .toLowerCase();
}

export function financesTransactionMatchesOrder(
  transaction: { id?: unknown },
  order: { orderId?: string; orderNumber?: string },
): boolean {
  const txKey = String(transaction.id || "").trim().toLowerCase();
  const id = String(order.orderId || "").trim().toLowerCase();
  const onum = String(order.orderNumber || "").trim().toLowerCase();
  if (!txKey) return false;
  return txKey === id || (onum.length > 0 && txKey === onum);
}

export type FinancesVendorPayoutStatus = "pending" | "accrued" | "completed";

export type FinancesVendorPayoutRow = {
  id: string;
  vendor: string;
  email: string;
  payout: number;
  orders: number;
  status: FinancesVendorPayoutStatus;
};

/** Badge label for super-admin vendor payout rows (accrued earnings, not KBZPay withdrawals). */
export function vendorPayoutDisplayStatus(statuses: unknown[]): FinancesVendorPayoutStatus {
  const accrued = statuses
    .map((raw) => normalizeFinancesOrderStatus(raw))
    .filter((status) => isAccruedFinancesOrder(status));
  if (accrued.length === 0) return "pending";
  const allCompleted = accrued.every(
    (status) => status === "delivered" || status === "completed" || status === "complete",
  );
  if (allCompleted) return "completed";
  const anyReady = accrued.some(
    (status) =>
      status === "ready-to-ship" ||
      status === "readytoship" ||
      status === "fulfilled" ||
      status === "shipped" ||
      status === "in-transit" ||
      status === "shipping" ||
      status === "delivered" ||
      status === "completed" ||
      status === "complete",
  );
  return anyReady ? "accrued" : "pending";
}

export function aggregateVendorPayoutsFromTransactions(
  transactions: Array<Record<string, unknown>>,
  emailById?: Map<string, string>,
): FinancesVendorPayoutRow[] {
  const map = new Map<string, FinancesVendorPayoutRow & { statuses: unknown[] }>();
  for (const txn of transactions) {
    if (isCancelledFinancesOrder(txn.status) || !isAccruedFinancesOrder(txn.status)) continue;
    const id = String(txn.vendorId || txn.vendor || "unknown");
    const cur =
      map.get(id) || {
        id,
        vendor: String(txn.vendor || "Unknown"),
        email: emailById?.get(id) || "",
        payout: 0,
        orders: 0,
        status: "pending" as const,
        statuses: [] as unknown[],
      };
    cur.payout += vendorPayoutExcludingShipping(txn);
    cur.orders += 1;
    cur.statuses.push(txn.status);
    if (!cur.email && emailById?.has(id)) cur.email = emailById.get(id)!;
    if (txn.vendor) cur.vendor = String(txn.vendor);
    map.set(id, cur);
  }
  return Array.from(map.values()).map(({ statuses, ...row }) => ({
    ...row,
    status: vendorPayoutDisplayStatus(statuses),
  }));
}
