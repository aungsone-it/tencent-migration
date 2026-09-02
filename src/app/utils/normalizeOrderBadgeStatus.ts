/** Map arbitrary API / UI strings to keys used by admin order badge maps (never undefined lookups). */

export type AdminOrderBadgeStatus =
  | "pending"
  | "processing"
  | "fulfilled"
  | "cancelled"
  | "ready-to-ship";

export type AdminPaymentBadgeStatus = "paid" | "unpaid" | "refunded" | "pending-refund";

export type AdminShippingBadgeStatus = "pending" | "shipped" | "delivered" | "cancelled";

export function normalizeAdminOrderStatusForBadge(raw: unknown): AdminOrderBadgeStatus {
  const s = String(raw ?? "pending")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
  if (s === "delivered" || s === "completed" || s === "complete") return "fulfilled";
  if (s === "shipped" || s === "in-transit" || s === "shipping" || s === "dispatch") return "processing";
  if (s === "ready-to-ship" || s === "readytoship" || s === "ready") {
    return "ready-to-ship";
  }
  if (s === "canceled") return "cancelled";
  if (s === "cancelled") return "cancelled";
  if (s === "processing" || s === "in-progress") return "processing";
  if (s === "fulfilled") return "fulfilled";
  if (s === "pending-payment" || s === "pending") return "pending";
  if (s === "confirmed") return "processing";
  return "processing";
}

/** Collapse duplicate KV order rows before badge / digest / list counts. */
export function dedupeOrdersByCanonicalForBadge(rows: unknown[]): unknown[] {
  type OrderRow = {
    id?: unknown;
    orderNumber?: unknown;
    updatedAt?: unknown;
    createdAt?: unknown;
    date?: unknown;
  };

  const score = (o: OrderRow) =>
    Math.max(
      new Date(String(o?.updatedAt || "")).getTime() || 0,
      new Date(String(o?.createdAt || o?.date || "")).getTime() || 0,
    );

  const aliasKeys = (o: OrderRow): string[] => {
    const num = String(o.orderNumber || "").trim().toLowerCase();
    const id = String(o.id || "").trim().toLowerCase();
    const keys = new Set<string>();
    if (num) keys.add(`n:${num}`);
    if (id) keys.add(`i:${id}`);
    if (num) keys.add(`i:${num}`);
    if (id) keys.add(`n:${id}`);
    return [...keys];
  };

  const merged: OrderRow[] = [];
  const aliasToIdx = new Map<string, number>();

  const linkRow = (idx: number, o: OrderRow) => {
    for (const k of aliasKeys(o)) aliasToIdx.set(k, idx);
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const o = row as OrderRow;

    let targetIdx: number | undefined;
    for (const k of aliasKeys(o)) {
      const idx = aliasToIdx.get(k);
      if (idx !== undefined) {
        targetIdx = idx;
        break;
      }
    }

    if (targetIdx !== undefined) {
      const prev = merged[targetIdx];
      if (score(o) >= score(prev)) merged[targetIdx] = o;
      linkRow(targetIdx, merged[targetIdx]);
    } else {
      merged.push(o);
      linkRow(merged.length - 1, o);
    }
  }

  return merged;
}

/** Stable React key + selection id for admin order rows. */
export function getOrderListRowKey(order: {
  id?: unknown;
  orderNumber?: unknown;
}): string {
  const num = String(order.orderNumber || "").trim();
  const id = String(order.id || "").trim();
  return (num || id || "unknown-order").toLowerCase();
}

/** Strict pending check for sidebar/bell badges — only brand-new orders count. */
export function isPendingOrderForBadge(raw: unknown): boolean {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
  return s === "pending" || s === "pending-payment";
}

export function normalizePaymentBadgeStatus(raw: unknown): AdminPaymentBadgeStatus {
  const s = String(raw ?? "unpaid").trim().toLowerCase().replace(/_/g, "-");
  if (s === "paid" || s === "complete") return "paid";
  if (s === "refunded" || s === "refund") return "refunded";
  if (s === "pending-refund" || s === "pendingrefund") return "pending-refund";
  return "unpaid";
}

const PAYMENT_STATUS_LABELS: Record<AdminPaymentBadgeStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  refunded: "Refunded",
  "pending-refund": "Pending Refund",
};

/** Human-readable payment label for invoices and exports. */
export function formatPaymentStatusLabel(raw: unknown): string {
  return PAYMENT_STATUS_LABELS[normalizePaymentBadgeStatus(raw)];
}

export function normalizeShippingBadgeStatus(raw: unknown): AdminShippingBadgeStatus {
  const s = String(raw ?? "pending")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
  if (s === "delivered" || s === "delivery") return "delivered";
  if (s === "shipped" || s === "shipping" || s === "in-transit") return "shipped";
  if (s === "cancelled" || s === "canceled" || s === "cancel") return "cancelled";
  return "pending";
}

type OrderLikeForBadges = {
  status?: unknown;
  paymentStatus?: unknown;
  paymentMethod?: unknown;
  shippingStatus?: unknown;
  kpay?: {
    status?: string;
    refund?: { status?: string };
  };
};

/** Payment badge value for admin order rows (cancelled → Refund, not Unpaid). */
export function derivePaymentStatusFromOrder(order: OrderLikeForBadges): string {
  const cancelled = normalizeAdminOrderStatusForBadge(order.status) === "cancelled";
  const raw = String(order.paymentStatus || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  if (cancelled) {
    if (raw === "refunded") return "refunded";
    const kpayRefund = String(order.kpay?.refund?.status || "").toLowerCase();
    if (kpayRefund === "success" || kpayRefund === "already-refunded" || kpayRefund === "already_refunded") {
      return "refunded";
    }
    return "pending_refund";
  }

  if (raw === "pending-refund" || raw === "pendingrefund") return "pending_refund";
  if (raw === "refunded" || raw === "refund") return "refunded";
  if (raw === "paid" || raw === "complete") return "paid";
  if (raw === "unpaid") return "unpaid";
  if (order.paymentMethod === "Cash on Delivery" || order.paymentMethod === "cod") return "unpaid";
  return "paid";
}

/** Shipping badge value for admin order rows (cancelled → Cancel, not Pending). */
export function deriveShippingStatusFromOrder(order: OrderLikeForBadges): AdminShippingBadgeStatus {
  if (normalizeAdminOrderStatusForBadge(order.status) === "cancelled") {
    return "cancelled";
  }
  const stored = normalizeShippingBadgeStatus(order.shippingStatus);
  if (order.shippingStatus != null && String(order.shippingStatus).trim() !== "") {
    return stored;
  }
  const st = String(order.status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (st === "delivered" || st === "fulfilled") return "delivered";
  if (st === "shipped") return "shipped";
  return "pending";
}

const CUSTOMER_ORDER_STATUS_LABELS: Record<AdminOrderBadgeStatus, string> = {
  pending: "Pending",
  processing: "Shipped",
  fulfilled: "Delivered",
  cancelled: "Cancelled",
  "ready-to-ship": "Shipping",
};

/** Customer-facing order history badge label (never shows raw API values like pending_payment). */
export function getCustomerOrderStatusLabel(raw: unknown): string {
  const key = normalizeAdminOrderStatusForBadge(raw);
  return CUSTOMER_ORDER_STATUS_LABELS[key];
}

/** Tailwind background class for customer order status badges. */
export function getCustomerOrderStatusColor(raw: unknown): string {
  const key = normalizeAdminOrderStatusForBadge(raw);
  switch (key) {
    case "fulfilled":
      return "bg-emerald-600";
    case "processing":
      return "bg-blue-600";
    case "ready-to-ship":
      return "bg-blue-600";
    case "cancelled":
      return "bg-red-600";
    default:
      return "bg-slate-600";
  }
}
