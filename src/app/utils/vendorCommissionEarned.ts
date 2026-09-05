/**
 * Vendor commission / payout math.
 *
 * Dashboard "Commission Earned" = vendor net (product line − platform commission) on
 * processing/ready-to-ship+ orders. Payment does not need to be collected yet (COD unpaid
 * still accrues). KBZPay withdrawal uses the stricter withdrawable helper.
 */
import {
  defaultVendorCommissionPercent,
  resolveLineCommissionPercentFromProducts,
} from "./commissionRate";

export type VendorCatalogKeys = { ids: Set<string>; skus: Set<string> };

function parseOrderMoney(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeOrderStatusKey(status: string | undefined): string {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function normalizePaymentKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

/** Revenue/commission dashboard cards — processing onward (inventory must be committed). */
export const VENDOR_COMMISSION_ACCRUE_STATUSES = new Set([
  "processing",
  "ready-to-ship",
  "fulfilled",
  "shipped",
  "delivered",
]);

/** Platform default when admin has not set vendor contract or product rate. */
export const PLATFORM_DEFAULT_COMMISSION_PERCENT = 0;

/** Orders eligible for KBZPay commission withdrawal — order status only (ready-to-ship onward). */
export const VENDOR_WITHDRAWABLE_STATUSES = new Set([
  "ready-to-ship",
  "fulfilled",
  "shipped",
  "delivered",
]);

function orderRefundBlocksWithdraw(order: any): boolean {
  const pay = normalizePaymentKey(order?.paymentStatus);
  if (pay === "refunded" || pay === "pending-refund") return true;
  const kpayRefund = normalizePaymentKey(order?.kpay?.refund?.status);
  return (
    kpayRefund === "success" ||
    kpayRefund === "already-refunded" ||
    kpayRefund === "already_refunded"
  );
}

/** Dashboard accrual: inventory committed and status in the fulfillment pipeline. */
export function isVendorOrderAccrued(order: any): boolean {
  if (order == null || typeof order !== "object") return false;
  const st = normalizeOrderStatusKey(String(order.status ?? ""));
  if (st === "cancelled" || st === "canceled") return false;
  if (!VENDOR_COMMISSION_ACCRUE_STATUSES.has(st)) return false;
  if (order.inventoryDeducted === false) return false;
  return true;
}

export function isVendorOrderWithdrawable(order: any): boolean {
  if (order == null || typeof order !== "object") return false;
  const st = normalizeOrderStatusKey(String(order.status ?? ""));
  if (st === "cancelled" || st === "canceled") return false;
  if (!VENDOR_WITHDRAWABLE_STATUSES.has(st)) return false;
  if (order.inventoryDeducted === false) return false;
  if (orderRefundBlocksWithdraw(order)) return false;
  return true;
}

export function buildVendorCatalogKeys(products: any[]): VendorCatalogKeys {
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const p of products) {
    if (p?.id != null && String(p.id).trim() !== "") ids.add(String(p.id).trim());
    if (p?.sku != null && String(p.sku).trim() !== "") skus.add(String(p.sku).trim());
  }
  return { ids, skus };
}

export function lineItemBelongsToVendor(
  item: any,
  vendorId: string,
  catalog?: VendorCatalogKeys
): boolean {
  if (item == null || typeof item !== "object") return false;
  const vid = String(vendorId ?? "").trim();
  if (!vid) return false;
  const idCandidates = [item.vendorId, item.vendor, item.product?.vendorId].filter(
    (x) => x != null && String(x).trim() !== ""
  );
  if (idCandidates.some((x) => String(x).trim() === vid)) return true;
  const sel = item.product?.selectedVendors ?? item.selectedVendors;
  if (Array.isArray(sel) && sel.some((x: unknown) => String(x).trim() === vid)) return true;
  const hasExplicitVendor =
    idCandidates.length > 0 || (Array.isArray(sel) && sel.length > 0);
  if (hasExplicitVendor) return false;
  if (catalog && (catalog.ids.size > 0 || catalog.skus.size > 0)) {
    const pid = item.productId != null ? String(item.productId).trim() : "";
    const sku = item.sku != null ? String(item.sku).trim() : "";
    const cartId = item.id != null ? String(item.id).trim() : "";
    const idFromCart = cartId.includes(":") ? cartId.split(":")[0]!.trim() : "";
    if (pid && catalog.ids.has(pid)) return true;
    if (idFromCart && catalog.ids.has(idFromCart)) return true;
    if (sku && catalog.skus.has(sku)) return true;
  }
  return false;
}

export function orderLineGross(item: any): number {
  if (item.subtotal != null && item.subtotal !== "") return parseOrderMoney(item.subtotal);
  if (item.total != null && item.total !== "") return parseOrderMoney(item.total);
  const qty = Math.max(1, parseOrderMoney(item.quantity) || 1);
  const unit = parseOrderMoney(item.price ?? item.product?.price);
  return unit * qty;
}

export function orderLineNetAfterDiscount(lineGross: number, order: any): number {
  const orderSub = parseOrderMoney(order.subtotal);
  const orderDisc = parseOrderMoney(order.discount);
  if (orderSub > 0 && orderDisc > 0) {
    const net = lineGross - (orderDisc * lineGross) / orderSub;
    return Math.max(0, Math.round(net * 100) / 100);
  }
  return lineGross;
}

function lineCommissionPercent(item: any, products: any[], vendorContractPercent: number): number {
  return resolveLineCommissionPercentFromProducts(item, products, vendorContractPercent);
}

function orderVendorKey(order: any): string {
  if (order?.vendorId != null && String(order.vendorId).trim() !== "") {
    return String(order.vendorId).trim();
  }
  if (order?.vendor != null && String(order.vendor).trim() !== "") {
    return String(order.vendor).trim();
  }
  if (order?.vendorName != null && String(order.vendorName).trim() !== "") {
    return String(order.vendorName).trim();
  }
  return "";
}

function vendorKeysMatch(left: string, right: string): boolean {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  return a === b || a.toLowerCase() === b.toLowerCase();
}

function vendorLineItemsForOrder(
  order: any,
  vendorId: string,
  catalog: VendorCatalogKeys,
): any[] {
  const lineItems = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.products)
      ? order.products
      : [];
  const matched = lineItems.filter((item: any) => lineItemBelongsToVendor(item, vendorId, catalog));
  if (matched.length > 0) return matched;
  if (lineItems.length === 0) return [];
  const orderVendor = orderVendorKey(order);
  const vid = String(vendorId ?? "").trim();
  // Vendor-admin SQL pages omit order.vendorId; items often store the store name ("go go")
  // instead of the internal vendor_* id. Those lists are already vendor-scoped.
  if (!orderVendor || vendorKeysMatch(orderVendor, vid)) return lineItems;
  return [];
}

function orderProductSubtotal(order: any): number {
  const sub = parseOrderMoney(order?.subtotal);
  if (sub > 0) return sub;
  const total = parseOrderMoney(order?.total);
  const shipping = parseOrderMoney(order?.shippingFee ?? order?.shippingCost ?? order?.shipping);
  if (total > 0 && shipping > 0 && total >= shipping) return Math.round((total - shipping) * 100) / 100;
  return 0;
}

function sumVendorLineAmounts(
  orders: any[],
  products: any[],
  vendorId: string,
  defaultCommissionPercent: number,
  eligible: (order: any) => boolean,
  amountForLine: (net: number, pct: number) => number,
): number {
  const catalog = buildVendorCatalogKeys(products);
  const contractPct = defaultVendorCommissionPercent(defaultCommissionPercent);
  let total = 0;

  for (const order of orders) {
    if (order == null || typeof order !== "object") continue;
    if (!eligible(order)) continue;
    const lines = vendorLineItemsForOrder(order, vendorId, catalog);
    if (lines.length > 0) {
      for (const item of lines) {
        const gross = orderLineGross(item);
        const net = orderLineNetAfterDiscount(gross, order);
        const pct = lineCommissionPercent(item, products, contractPct);
        total += amountForLine(net, pct);
      }
      continue;
    }
    const subtotal = orderProductSubtotal(order);
    if (subtotal > 0) {
      total += amountForLine(subtotal, contractPct);
    }
  }

  return Math.round(total * 100) / 100;
}

/**
 * Platform commission (MMK) on accrued statuses — product lines only, shipping excluded.
 */
export function computeVendorCommissionEarned(
  orders: any[],
  products: any[],
  vendorId: string,
  defaultCommissionPercent: number
): number {
  return sumVendorLineAmounts(
    orders,
    products,
    vendorId,
    defaultCommissionPercent,
    isVendorOrderAccrued,
    (net, pct) => (net * pct) / 100,
  );
}

/**
 * Vendor net (product − platform commission) on accrued statuses.
 * Unpaid COD ready-to-ship still counts; this is the dashboard "Commission Earned" card.
 */
export function computeVendorPayoutAccrued(
  orders: any[],
  products: any[],
  vendorId: string,
  defaultCommissionPercent: number
): number {
  return sumVendorLineAmounts(
    orders,
    products,
    vendorId,
    defaultCommissionPercent,
    isVendorOrderAccrued,
    (net, pct) => Math.max(0, net - (net * pct) / 100),
  );
}

/** Vendor net on withdrawable orders (ready-to-ship+; payment status ignored). */
export function computeVendorPayoutEarned(
  orders: any[],
  products: any[],
  vendorId: string,
  defaultCommissionPercent: number
): number {
  return sumVendorLineAmounts(
    orders,
    products,
    vendorId,
    defaultCommissionPercent,
    isVendorOrderWithdrawable,
    (net, pct) => Math.max(0, net - (net * pct) / 100),
  );
}
