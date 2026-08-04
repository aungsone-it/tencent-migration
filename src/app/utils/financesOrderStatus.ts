/** Status helpers for super-admin Finances cards and transaction filters. */

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
