/**
 * Vendor commission earned — aligned with server-side vendor_commission_withdraw.tsx:
 * accrues on ready-to-ship+ orders with collected payment, per line net of order-level discount.
 */

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

/** Orders eligible for KBZPay commission withdrawal (ready-to-ship onward, payment collected). */
export const VENDOR_WITHDRAWABLE_STATUSES = new Set([
  "ready-to-ship",
  "fulfilled",
  "shipped",
  "delivered",
]);

const COD_COLLECTED_STATUSES = new Set(["fulfilled", "delivered"]);

function isCodPaymentMethod(order: any): boolean {
  const method = normalizePaymentKey(order?.paymentMethod);
  return method === "cod" || method.includes("cash-on-delivery") || method.includes("cash on delivery");
}

function isKpayPaymentMethod(order: any): boolean {
  const method = normalizePaymentKey(order?.paymentMethod);
  return method.includes("kpay") || method.includes("kbz");
}

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

function isOrderPaymentCollected(order: any): boolean {
  const pay = normalizePaymentKey(order?.paymentStatus);
  const st = normalizeOrderStatusKey(String(order?.status ?? ""));
  const kpayStatus = normalizePaymentKey(order?.kpay?.status);

  if (orderRefundBlocksWithdraw(order)) return false;
  if (pay === "unpaid" || pay === "pending" || pay === "pending-verification") return false;

  if (isCodPaymentMethod(order)) {
    return COD_COLLECTED_STATUSES.has(st);
  }

  if (isKpayPaymentMethod(order)) {
    return pay === "paid" || kpayStatus === "paid";
  }

  return pay === "paid" || pay === "complete";
}

export function isVendorOrderWithdrawable(order: any): boolean {
  if (order == null || typeof order !== "object") return false;
  const st = normalizeOrderStatusKey(String(order.status ?? ""));
  if (st === "cancelled" || st === "canceled") return false;
  if (!VENDOR_WITHDRAWABLE_STATUSES.has(st)) return false;
  if (order.inventoryDeducted === false) return false;
  if (!isOrderPaymentCollected(order)) return false;
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

function explicitCommissionPercent(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parseOrderMoney(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function productHasExplicitCommissionRate(product: any): boolean {
  return (
    product?.commissionRate !== undefined &&
    product?.commissionRate !== null &&
    String(product.commissionRate).trim() !== ""
  );
}

function defaultVendorCommissionPercent(value: unknown): number {
  if (value == null || value === "") return PLATFORM_DEFAULT_COMMISSION_PERCENT;
  const parsed = explicitCommissionPercent(value);
  return parsed != null ? parsed : PLATFORM_DEFAULT_COMMISSION_PERCENT;
}

function lineCommissionPercent(item: any, products: any[], vendorContractPercent: number): number {
  const fromLine = explicitCommissionPercent(
    item.commissionRate ?? item.commission ?? item.product?.commissionRate ?? item.product?.commission
  );
  if (fromLine != null) return fromLine;

  const matched = products.find(
    (p: any) =>
      (item.sku && p.sku === item.sku) ||
      (item.productId != null && p.id != null && String(p.id) === String(item.productId))
  );
  if (matched && productHasExplicitCommissionRate(matched)) {
    const fromProduct = explicitCommissionPercent(matched.commissionRate ?? matched.commission);
    if (fromProduct != null) return fromProduct;
  }
  return vendorContractPercent;
}

/**
 * Total commission (MMK) the vendor has earned on accrued statuses.
 */
export function computeVendorCommissionEarned(
  orders: any[],
  products: any[],
  vendorId: string,
  defaultCommissionPercent: number
): number {
  const catalog = buildVendorCatalogKeys(products);
  let commission = 0;

  for (const order of orders) {
    if (order == null || typeof order !== "object") continue;
    const st = normalizeOrderStatusKey(String(order.status ?? ""));
    if (!VENDOR_COMMISSION_ACCRUE_STATUSES.has(st)) continue;
    if (order.inventoryDeducted === false) continue;

    const lineItems = Array.isArray(order.items) ? order.items : [];
    for (const item of lineItems) {
      if (!lineItemBelongsToVendor(item, vendorId, catalog)) continue;
      const gross = orderLineGross(item);
      const net = orderLineNetAfterDiscount(gross, order);
      const pct = lineCommissionPercent(item, products, defaultCommissionPercent);
      commission += (net * pct) / 100;
    }
  }

  return Math.round(commission * 100) / 100;
}

/** Vendor net earnings after platform commission (withdrawable balance basis). */
export function computeVendorPayoutEarned(
  orders: any[],
  products: any[],
  vendorId: string,
  defaultCommissionPercent: number
): number {
  const catalog = buildVendorCatalogKeys(products);
  const contractPct = defaultVendorCommissionPercent(defaultCommissionPercent);
  let payout = 0;

  for (const order of orders) {
    if (order == null || typeof order !== "object") continue;
    if (!isVendorOrderWithdrawable(order)) continue;

    const lineItems = Array.isArray(order.items) ? order.items : [];
    let matchedAnyLine = false;
    for (const item of lineItems) {
      if (!lineItemBelongsToVendor(item, vendorId, catalog)) continue;
      matchedAnyLine = true;
      const gross = orderLineGross(item);
      const net = orderLineNetAfterDiscount(gross, order);
      const pct = lineCommissionPercent(item, products, contractPct);
      payout += Math.max(0, net - (net * pct) / 100);
    }

    const orderVendor =
      order.vendorId != null
        ? String(order.vendorId).trim()
        : order.vendor != null
          ? String(order.vendor).trim()
          : "";
    if (!matchedAnyLine && lineItems.length > 0 && orderVendor && orderVendor === String(vendorId).trim()) {
      for (const item of lineItems) {
        const gross = orderLineGross(item);
        const net = orderLineNetAfterDiscount(gross, order);
        const pct = lineCommissionPercent(item, products, contractPct);
        payout += Math.max(0, net - (net * pct) / 100);
      }
    }
  }

  return Math.round(payout * 100) / 100;
}
