import { Context } from "hono";
import * as kv from "./kv_store.tsx";
import { invokeKPayBusinessPay, syncKPayTxnStatusFromProvider } from "./kpay_routes.tsx";
import {
  paidSubscriptionPaymentDate,
  subscriptionPaymentSplit,
} from "./subscription_finance.ts";
import { assertVendorSession } from "./vendor_session_guard.tsx";

type AnyRecord = Record<string, unknown>;

/** Commission payout accrues from ready-to-ship onward (not bare processing). */
const WITHDRAWABLE_STATUSES = new Set([
  "ready-to-ship",
  "fulfilled",
  "shipped",
  "delivered",
]);

/** COD is only withdrawable once delivery is confirmed. */
const COD_COLLECTED_STATUSES = new Set(["fulfilled", "delivered"]);

const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const RECONCILE_MIN_AGE_MS = 45 * 1000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseMoney(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseFloat(v.replace(/[^0-9.-]/g, "")) || 0;
  return 0;
}

function parseCommissionPercent(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (v == null || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function defaultVendorCommissionPercent(v: unknown): number {
  if (v == null || v === "") return 0;
  const parsed = parseCommissionPercent(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOrderStatus(status: unknown): string {
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

function isCodPaymentMethod(order: AnyRecord): boolean {
  const method = normalizePaymentKey(order.paymentMethod);
  return method === "cod" || method.includes("cash-on-delivery") || method.includes("cash on delivery");
}

function isKpayPaymentMethod(order: AnyRecord): boolean {
  const method = normalizePaymentKey(order.paymentMethod);
  return method.includes("kpay") || method.includes("kbz");
}

function orderRefundBlocksWithdraw(order: AnyRecord): boolean {
  const pay = normalizePaymentKey(order.paymentStatus);
  if (pay === "refunded" || pay === "pending-refund") return true;
  const kpayRefund = normalizePaymentKey((order.kpay as AnyRecord | undefined)?.refund?.status);
  return (
    kpayRefund === "success" ||
    kpayRefund === "already-refunded" ||
    kpayRefund === "already_refunded"
  );
}

function isOrderPaymentCollected(order: AnyRecord): boolean {
  const pay = normalizePaymentKey(order.paymentStatus);
  const st = normalizeOrderStatus(order.status);
  const kpayStatus = normalizePaymentKey((order.kpay as AnyRecord | undefined)?.status);

  if (orderRefundBlocksWithdraw(order)) return false;
  if (pay === "unpaid" || pay === "pending" || pay === "pending-verification") return false;

  if (isCodPaymentMethod(order)) {
    return COD_COLLECTED_STATUSES.has(st) || pay === "paid";
  }

  if (isKpayPaymentMethod(order)) {
    return pay === "paid" || kpayStatus === "paid";
  }

  return pay === "paid" || pay === "complete";
}

function orderLineGross(item: AnyRecord): number {
  if (item.subtotal != null && item.subtotal !== "") return parseMoney(item.subtotal);
  if (item.total != null && item.total !== "") return parseMoney(item.total);
  const qty = Math.max(1, parseMoney(item.quantity) || 1);
  const unit = parseMoney(item.price ?? (item.product as AnyRecord | undefined)?.price);
  return unit * qty;
}

function orderLineNetAfterDiscount(lineGross: number, order: AnyRecord): number {
  const orderSub = parseMoney(order.subtotal);
  const orderDisc = parseMoney(order.discount);
  if (orderSub > 0 && orderDisc > 0) {
    const net = lineGross - (orderDisc * lineGross) / orderSub;
    return Math.max(0, Math.round(net * 100) / 100);
  }
  return lineGross;
}

function explicitCommissionPercent(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = parseCommissionPercent(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineCommissionPercent(
  item: AnyRecord,
  productMap: Map<string, { commissionRate: unknown; hasExplicitRate: boolean }>,
  vendorContractPercent: number,
): number {
  const fromLine = explicitCommissionPercent(
    item.commissionRate ?? item.commission ?? (item.product as AnyRecord | undefined)?.commissionRate,
  );
  if (fromLine != null) return fromLine;

  const keys: string[] = [];
  const rawPid = item.productId ?? item.id;
  if (rawPid != null) {
    const s = String(rawPid).trim();
    if (s) {
      keys.push(s);
      if (s.includes(":")) keys.push(s.split(":")[0]!.trim());
    }
  }
  const sku = item.sku != null ? String(item.sku).trim() : "";
  if (sku) keys.push(sku);

  for (const k of keys) {
    const hit = productMap.get(k);
    if (hit?.hasExplicitRate) {
      const pct = explicitCommissionPercent(hit.commissionRate);
      if (pct != null) return pct;
    }
  }
  return vendorContractPercent;
}

function isOrderWithdrawable(order: AnyRecord): boolean {
  if (!order || typeof order !== "object") return false;
  const st = normalizeOrderStatus(order.status);
  if (st === "cancelled" || st === "canceled") return false;
  if (!WITHDRAWABLE_STATUSES.has(st)) return false;
  if (order.inventoryDeducted === false) return false;
  if (!isOrderPaymentCollected(order)) return false;
  return true;
}

function buildVendorCatalogKeys(products: AnyRecord[]): { ids: Set<string>; skus: Set<string> } {
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const p of products) {
    if (p?.id != null && String(p.id).trim() !== "") ids.add(String(p.id).trim());
    if (p?.sku != null && String(p.sku).trim() !== "") skus.add(String(p.sku).trim());
  }
  return { ids, skus };
}

function lineItemBelongsToVendor(
  item: AnyRecord,
  vendorId: string,
  vendorIds: Set<string>,
  catalog: { ids: Set<string>; skus: Set<string> },
): boolean {
  const vid = String(vendorId ?? "").trim();
  if (!vid || item == null) return false;
  const normalizedVendorIds = new Set(
    [...vendorIds, vid].map((value) => String(value).trim()).filter(Boolean),
  );

  const idCandidates = [item.vendorId, item.vendor, (item.product as AnyRecord | undefined)?.vendorId].filter(
    (x) => x != null && String(x).trim() !== "",
  );
  if (idCandidates.some((x) => normalizedVendorIds.has(String(x).trim()))) return true;

  const sel = (item.product as AnyRecord | undefined)?.selectedVendors ?? item.selectedVendors;
  if (Array.isArray(sel) && sel.some((x: unknown) => normalizedVendorIds.has(String(x).trim()))) {
    return true;
  }

  if (catalog.ids.size > 0 || catalog.skus.size > 0) {
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

function orderBelongsToVendor(order: AnyRecord, vendorIds: Set<string>): boolean {
  const top = [order.vendorId, order.vendor].filter(
    (x) => x != null && String(x).trim() !== "",
  );
  return top.some((x) => vendorIds.has(String(x).trim()));
}

function normalizeMyanmarKpayPhone(raw: unknown): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("959") && digits.length >= 11) {
    digits = "0" + digits.slice(2);
  }
  if (digits.startsWith("95") && digits.length >= 10 && !digits.startsWith("959")) {
    digits = "0" + digits.slice(2);
  }
  if (!digits.startsWith("09") || digits.length < 8 || digits.length > 15) return null;
  return digits;
}

async function resolveVendorIdentifierSet(vendorId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const key = String(vendorId || "").trim();
  if (!key) return ids;
  ids.add(key);

  const vendor = (await kv.get(`vendor:${key}`)) as AnyRecord | null;
  if (vendor) {
    if (vendor.id) ids.add(String(vendor.id));
    if (vendor.email) ids.add(String(vendor.email).toLowerCase());
    if (vendor.storeSlug) ids.add(String(vendor.storeSlug));
  }
  return ids;
}

function productBelongsToVendor(product: AnyRecord, vendorIds: Set<string>): boolean {
  const candidates = [
    product.vendorId,
    product.vendor,
    ...(Array.isArray(product.selectedVendors) ? product.selectedVendors : []),
  ].filter((x) => x != null && String(x).trim() !== "");
  return candidates.some((x) => vendorIds.has(String(x).trim()));
}

function buildProductMap(products: AnyRecord[]): Map<string, { commissionRate: unknown; hasExplicitRate: boolean }> {
  const map = new Map<string, { commissionRate: unknown; hasExplicitRate: boolean }>();
  for (const product of products) {
    if (!product?.id) continue;
    const hasExplicitRate =
      product.commissionRate !== undefined &&
      product.commissionRate !== null &&
      String(product.commissionRate).trim() !== "";
    const info = {
      commissionRate: hasExplicitRate ? product.commissionRate : null,
      hasExplicitRate,
    };
    const idKey = String(product.id).trim();
    map.set(idKey, info);
    const sku = product.sku != null ? String(product.sku).trim() : "";
    if (sku && sku !== idKey) map.set(sku, info);
  }
  return map;
}

function computeVendorAccruedPayout(
  orders: AnyRecord[],
  products: AnyRecord[],
  vendorId: string,
  vendorIds: Set<string>,
  defaultCommissionPercent: number,
): number {
  const productMap = buildProductMap(products);
  const catalog = buildVendorCatalogKeys(products);
  let payout = 0;

  for (const order of orders) {
    if (!order || typeof order !== "object") continue;
    if (!isOrderWithdrawable(order)) continue;

    const items = Array.isArray(order.items) ? order.items : [];
    let matchedAnyLine = false;
    let matchedLinePayout = 0;

    for (const item of items) {
      if (!lineItemBelongsToVendor(item as AnyRecord, vendorId, vendorIds, catalog)) continue;
      matchedAnyLine = true;
      const gross = orderLineGross(item as AnyRecord);
      const net = orderLineNetAfterDiscount(gross, order);
      const pct = lineCommissionPercent(item as AnyRecord, productMap, defaultCommissionPercent);
      const platformComm = (net * pct) / 100;
      const linePayout = Math.max(0, net - platformComm);
      matchedLinePayout += linePayout;
      payout += linePayout;
    }

    // Single-vendor order with no line-level vendor tags — attribute matched lines only.
    if (!matchedAnyLine && items.length > 0 && orderBelongsToVendor(order, vendorIds)) {
      for (const item of items) {
        const gross = orderLineGross(item as AnyRecord);
        const net = orderLineNetAfterDiscount(gross, order);
        const pct = lineCommissionPercent(item as AnyRecord, productMap, defaultCommissionPercent);
        payout += Math.max(0, net - (net * pct) / 100);
      }
    } else if (matchedAnyLine && matchedLinePayout <= 0) {
      continue;
    }
  }

  return Math.round(payout * 100) / 100;
}

function computeVendorSubscriptionPayout(
  payments: AnyRecord[],
  vendorId: string,
): number {
  return payments.reduce((sum, payment) => {
    if (
      !paidSubscriptionPaymentDate(payment) ||
      String(payment?.vendorId || "").trim() !== vendorId
    ) {
      return sum;
    }
    return sum + subscriptionPaymentSplit(payment).vendorPayout;
  }, 0);
}

type VendorWithdrawalRecord = {
  id: string;
  vendorId: string;
  amount: number;
  currency: string;
  kpayPhone: string;
  merchOrderId: string;
  status: "pending" | "processing" | "paid" | "failed";
  kbz?: AnyRecord;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
};

type WithdrawLockRecord = {
  withdrawalId: string;
  vendorId: string;
  amount: number;
  status: "pending" | "processing" | "paid" | "failed";
  merchOrderId?: string;
  createdAt: string;
  updatedAt: string;
};

async function listVendorWithdrawals(vendorId: string): Promise<VendorWithdrawalRecord[]> {
  const rows = (await kv.get(`vendor_withdrawals:${vendorId}`)) as VendorWithdrawalRecord[] | null;
  return Array.isArray(rows) ? rows : [];
}

async function saveVendorWithdrawals(vendorId: string, rows: VendorWithdrawalRecord[]): Promise<void> {
  await kv.set(`vendor_withdrawals:${vendorId}`, rows);
}

function withdrawnTotal(rows: VendorWithdrawalRecord[]): number {
  return rows
    .filter(
      (r) =>
        (r.status === "paid" || r.status === "processing" || r.status === "pending") &&
        (text(r.kbz?.endpointUsed).toLowerCase() !== "mock" ||
          r.kbz?.countsAsWithdrawal === true),
    )
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

function paidWithdrawalCountsTowardBalance(row: VendorWithdrawalRecord): boolean {
  return (
    row.status === "paid" &&
    (text(row.kbz?.endpointUsed).toLowerCase() !== "mock" ||
      row.kbz?.countsAsWithdrawal === true)
  );
}

function withdrawableMmk(totalEarned: number, reserved: number): number {
  return Math.max(0, Math.floor(totalEarned - reserved + Number.EPSILON));
}

function minWithdrawAmountMmk(): number {
  const raw = Number(Deno.env.get("VENDOR_WITHDRAW_MIN_MMK") || "1");
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 1;
}

function lockKey(vendorId: string): string {
  return `vendor_withdraw_lock:${vendorId}`;
}

function lockIsStale(lock: WithdrawLockRecord | null): boolean {
  if (!lock) return true;
  const ts = Date.parse(String(lock.updatedAt || lock.createdAt || ""));
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts >= LOCK_STALE_MS;
}

async function readWithdrawLock(vendorId: string): Promise<WithdrawLockRecord | null> {
  const lock = (await kv.get(lockKey(vendorId))) as WithdrawLockRecord | null;
  return lock && typeof lock === "object" ? lock : null;
}

async function acquireWithdrawLock(
  vendorId: string,
  withdrawalId: string,
  amount: number,
  merchOrderId: string,
): Promise<{ ok: true } | { ok: false; message: string; withdrawal?: VendorWithdrawalRecord }> {
  const existing = await readWithdrawLock(vendorId);
  if (
    existing &&
    (existing.status === "pending" || existing.status === "processing") &&
    !lockIsStale(existing)
  ) {
    const rows = await listVendorWithdrawals(vendorId);
    const inflight = rows.find((row) => row.id === existing.withdrawalId) ||
      rows.find((row) => row.status === "pending" || row.status === "processing");
    return {
      ok: false,
      message: "A withdrawal is already in progress. Please wait for it to complete.",
      withdrawal: inflight,
    };
  }

  const now = nowIso();
  const nextLock: WithdrawLockRecord = {
    withdrawalId,
    vendorId,
    amount,
    status: "pending",
    merchOrderId,
    createdAt: now,
    updatedAt: now,
  };
  await kv.set(lockKey(vendorId), nextLock);

  const verify = await readWithdrawLock(vendorId);
  if (!verify || verify.withdrawalId !== withdrawalId) {
    return {
      ok: false,
      message: "Could not reserve withdrawal balance. Please try again.",
    };
  }

  return { ok: true };
}

async function updateWithdrawLock(
  vendorId: string,
  withdrawalId: string,
  status: WithdrawLockRecord["status"],
): Promise<void> {
  const lock = await readWithdrawLock(vendorId);
  if (!lock || lock.withdrawalId !== withdrawalId) return;
  if (status === "failed") {
    await kv.del(lockKey(vendorId));
    return;
  }
  await kv.set(lockKey(vendorId), { ...lock, status, updatedAt: nowIso() });
}

async function releaseWithdrawLock(vendorId: string, withdrawalId: string): Promise<void> {
  const lock = await readWithdrawLock(vendorId);
  if (lock?.withdrawalId === withdrawalId) {
    await kv.del(lockKey(vendorId));
  }
}

function payoutIsAmbiguous(
  payout: Awaited<ReturnType<typeof invokeKPayBusinessPay>>,
): boolean {
  if (payout.pending) return true;
  if (payout.networkError) return true;
  const msg = `${payout.providerMessage || ""} ${payout.networkError || ""}`.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("unreachable") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  );
}

async function reconcileProcessingWithdrawals(vendorId: string): Promise<void> {
  const rows = await listVendorWithdrawals(vendorId);
  let changed = false;

  for (const row of rows) {
    if (row.status !== "processing" && row.status !== "pending") continue;
    if (!row.merchOrderId) continue;

    const createdMs = Date.parse(String(row.createdAt || ""));
    if (Number.isFinite(createdMs) && Date.now() - createdMs < RECONCILE_MIN_AGE_MS) {
      continue;
    }

    const txn = await syncKPayTxnStatusFromProvider(row.merchOrderId);
    const providerStatus = text(txn?.status).toLowerCase();
    if (!providerStatus) continue;

    if (providerStatus === "paid" && row.status !== "paid") {
      row.status = "paid";
      row.updatedAt = nowIso();
      row.paidAt = nowIso();
      row.kbz = {
        ...(row.kbz || {}),
        tradeStatus: text(txn?.providerStatus) || "PAY_SUCCESS",
        reconciledAt: nowIso(),
        countsAsWithdrawal: true,
      };
      changed = true;
      await releaseWithdrawLock(vendorId, row.id);
    } else if (providerStatus === "failed" && row.status !== "failed") {
      row.status = "failed";
      row.updatedAt = nowIso();
      row.errorMessage = "KBZPay reported payout failure during reconciliation";
      changed = true;
      await releaseWithdrawLock(vendorId, row.id);
    }
  }

  if (changed) {
    await saveVendorWithdrawals(vendorId, rows);
  }
}

async function computeVendorWallet(vendorId: string) {
  await reconcileProcessingWithdrawals(vendorId);

  const vendor = (await kv.get(`vendor:${vendorId}`)) as AnyRecord | null;
  if (!vendor) {
    return null;
  }

  const vendorIds = await resolveVendorIdentifierSet(vendorId);
  const defaultCommissionPercent = defaultVendorCommissionPercent(vendor.commission);

  const [orders, products, subscriptionPayments, withdrawals] = await Promise.all([
    kv.getByPrefix("order:").catch(() => [] as AnyRecord[]),
    kv.getByPrefix("product:").catch(() => [] as AnyRecord[]),
    kv.getByPrefix("subscription_payment:").catch(() => [] as AnyRecord[]),
    listVendorWithdrawals(vendorId),
  ]);

  const validOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const validProducts = (Array.isArray(products) ? products.filter(Boolean) : []).filter((p) =>
    productBelongsToVendor(p as AnyRecord, vendorIds)
  );
  const orderPayout = computeVendorAccruedPayout(
    validOrders,
    validProducts,
    vendorId,
    vendorIds,
    defaultCommissionPercent,
  );
  const subscriptionPayout = computeVendorSubscriptionPayout(
    Array.isArray(subscriptionPayments) ? subscriptionPayments.filter(Boolean) : [],
    vendorId,
  );
  const totalEarned = Math.round((orderPayout + subscriptionPayout) * 100) / 100;
  const reserved = withdrawnTotal(withdrawals);
  const availableBalance = withdrawableMmk(totalEarned, reserved);

  return {
    vendorId,
    vendorName: text(vendor.businessName) || text(vendor.name) || vendorId,
    kpayPhone: text(vendor.kpayPhone) || text(vendor.kpayAccount) || "",
    totalEarned,
    totalWithdrawn: withdrawals
      .filter(paidWithdrawalCountsTowardBalance)
      .reduce((s, w) => s + w.amount, 0),
    reservedBalance: reserved,
    availableBalance,
    minWithdrawAmount: minWithdrawAmountMmk(),
    withdrawals: withdrawals.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

function makeMerchOrderId(vendorId: string): string {
  const compactVendor = String(vendorId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return `VWD-${compactVendor}-${ts}${rand}`.slice(0, 40);
}

function buildWalletResponse(wallet: NonNullable<Awaited<ReturnType<typeof computeVendorWallet>>>, kpayPhone?: string) {
  return {
    ...wallet,
    kpayPhone: kpayPhone ?? wallet.kpayPhone,
  };
}

export async function getVendorCommissionWallet(c: Context) {
  try {
    const vendorId = text(c.req.param("vendorId"));
    if (!vendorId) return c.json({ error: "vendorId is required" }, 400);

    const authError = await assertVendorSession(c, vendorId);
    if (authError) return authError;

    const wallet = await computeVendorWallet(vendorId);
    if (!wallet) return c.json({ error: "Vendor not found" }, 404);

    return c.json({ success: true, wallet });
  } catch (error: unknown) {
    console.error("getVendorCommissionWallet error", error);
    return c.json({ error: "Failed to load commission wallet" }, 500);
  }
}

export async function saveVendorKpayAccount(c: Context) {
  try {
    const vendorId = text(c.req.param("vendorId"));
    if (!vendorId) return c.json({ error: "vendorId is required" }, 400);

    const authError = await assertVendorSession(c, vendorId);
    if (authError) return authError;

    const body = (await c.req.json()) as AnyRecord;
    const kpayPhone = normalizeMyanmarKpayPhone(body.kpayPhone ?? body.kpayAccount ?? body.phone);
    if (!kpayPhone) {
      return c.json(
        { error: "Enter a valid KBZPay phone number (e.g. 09xxxxxxxxx)" },
        400,
      );
    }

    const vendor = (await kv.get(`vendor:${vendorId}`)) as AnyRecord | null;
    if (!vendor) return c.json({ error: "Vendor not found" }, 404);

    const updated = {
      ...vendor,
      kpayPhone,
      kpayAccount: kpayPhone,
      updatedAt: nowIso(),
    };
    await kv.set(`vendor:${vendorId}`, updated);

    return c.json({ success: true, kpayPhone });
  } catch (error: unknown) {
    console.error("saveVendorKpayAccount error", error);
    return c.json({ error: "Failed to save KBZPay account" }, 500);
  }
}

export async function postVendorCommissionWithdraw(c: Context) {
  try {
    const vendorId = text(c.req.param("vendorId"));
    if (!vendorId) return c.json({ error: "vendorId is required" }, 400);

    const authError = await assertVendorSession(c, vendorId);
    if (authError) return authError;

    const body = (await c.req.json().catch(() => ({}))) as AnyRecord;
    const wallet = await computeVendorWallet(vendorId);
    if (!wallet) return c.json({ error: "Vendor not found" }, 404);

    const vendor = (await kv.get(`vendor:${vendorId}`)) as AnyRecord | null;
    const savedPhone = normalizeMyanmarKpayPhone(wallet.kpayPhone);
    const bodyPhone = normalizeMyanmarKpayPhone(body.kpayPhone ?? body.kpayAccount);

    if (bodyPhone && savedPhone && bodyPhone !== savedPhone) {
      return c.json(
        {
          error: "KBZPay phone changed. Save your payout account first, then withdraw.",
        },
        400,
      );
    }

    const kpayPhone = savedPhone || bodyPhone;
    if (!kpayPhone) {
      return c.json({ error: "Save a KBZPay phone number before withdrawing" }, 400);
    }

    const requestedAmount =
      body.amount != null && body.amount !== ""
        ? Math.round(parseMoney(body.amount))
        : Math.floor(wallet.availableBalance);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return c.json({ error: "Withdrawal amount must be greater than zero" }, 400);
    }
    if (requestedAmount < wallet.minWithdrawAmount) {
      return c.json(
        {
          error: `Minimum withdrawal is ${wallet.minWithdrawAmount.toLocaleString()} MMK`,
        },
        400,
      );
    }
    if (requestedAmount > wallet.availableBalance) {
      return c.json(
        {
          error: `Insufficient balance. Available: ${wallet.availableBalance.toLocaleString()} MMK`,
        },
        400,
      );
    }

    const merchOrderId = makeMerchOrderId(vendorId);
    const withdrawalId = crypto.randomUUID();
    const createdAt = nowIso();

    const lock = await acquireWithdrawLock(vendorId, withdrawalId, requestedAmount, merchOrderId);
    if (!lock.ok) {
      return c.json(
        {
          error: lock.message,
          withdrawal: lock.withdrawal,
        },
        409,
      );
    }

    const pendingRecord: VendorWithdrawalRecord = {
      id: withdrawalId,
      vendorId,
      amount: requestedAmount,
      currency: "MMK",
      kpayPhone,
      merchOrderId,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    };

    const withdrawals = await listVendorWithdrawals(vendorId);
    withdrawals.unshift(pendingRecord);
    await saveVendorWithdrawals(vendorId, withdrawals);

    if (vendor && (!savedPhone || savedPhone !== kpayPhone)) {
      await kv.set(`vendor:${vendorId}`, {
        ...vendor,
        kpayPhone,
        kpayAccount: kpayPhone,
        updatedAt: nowIso(),
      });
    }

    let payout: Awaited<ReturnType<typeof invokeKPayBusinessPay>>;
    try {
      payout = await invokeKPayBusinessPay({
        merchantOrderId: merchOrderId,
        amountMmk: requestedAmount,
        payeePhone: kpayPhone,
        payeeName: text(vendor?.businessName) || text(vendor?.name) || undefined,
        title: "Vendor commission payout",
        note: `Commission withdrawal for ${wallet.vendorName}`,
      });
    } catch (kpayErr: unknown) {
      console.error("invokeKPayBusinessPay error", kpayErr);
      payout = {
        ok: false,
        success: false,
        pending: true,
        merchantOrderId: merchOrderId,
        providerMessage: String((kpayErr as Error)?.message || kpayErr || "KBZPay payout error"),
        networkError: "KBZPay request failed",
      };
    }

    const latestWithdrawals = await listVendorWithdrawals(vendorId);
    const idx = latestWithdrawals.findIndex((w) => w.id === withdrawalId);
    if (idx < 0) {
      await releaseWithdrawLock(vendorId, withdrawalId);
      return c.json({ error: "Withdrawal record lost" }, 500);
    }

    const updatedAt = nowIso();
    const ambiguous = payoutIsAmbiguous(payout);

    if (payout.success) {
      latestWithdrawals[idx] = {
        ...latestWithdrawals[idx],
        status: "paid",
        updatedAt,
        paidAt: updatedAt,
        kbz: {
          paymentOrderId: payout.paymentOrderId,
          mmOrderId: payout.mmOrderId,
          tradeStatus: payout.tradeStatus,
          endpointUsed: payout.endpointUsed,
          rawResponse: payout.rawResponse,
          countsAsWithdrawal: true,
        },
      };
      await updateWithdrawLock(vendorId, withdrawalId, "paid");
      await releaseWithdrawLock(vendorId, withdrawalId);
    } else if (payout.pending || ambiguous) {
      latestWithdrawals[idx] = {
        ...latestWithdrawals[idx],
        status: "processing",
        updatedAt,
        kbz: {
          paymentOrderId: payout.paymentOrderId,
          mmOrderId: payout.mmOrderId,
          tradeStatus: payout.tradeStatus,
          endpointUsed: payout.endpointUsed,
          rawResponse: payout.rawResponse,
          providerMessage: payout.providerMessage || payout.networkError,
          ambiguous: ambiguous || undefined,
        },
      };
      await updateWithdrawLock(vendorId, withdrawalId, "processing");
    } else {
      latestWithdrawals[idx] = {
        ...latestWithdrawals[idx],
        status: "failed",
        updatedAt,
        errorMessage: payout.providerMessage || payout.networkError || "KBZPay payout failed",
        kbz: {
          endpointUsed: payout.endpointUsed,
          rawResponse: payout.rawResponse,
          providerCode: payout.providerCode,
          providerMessage: payout.providerMessage,
        },
      };
      await releaseWithdrawLock(vendorId, withdrawalId);
    }

    await saveVendorWithdrawals(vendorId, latestWithdrawals);
    await kv.set(`vendor_withdrawal_txn:${merchOrderId}`, latestWithdrawals[idx]);

    const record = latestWithdrawals[idx];
    const reservedAfter = withdrawnTotal(latestWithdrawals);
    const refreshed = buildWalletResponse(
      {
        ...wallet,
        reservedBalance: reservedAfter,
        availableBalance: withdrawableMmk(wallet.totalEarned, reservedAfter),
        totalWithdrawn: latestWithdrawals
          .filter(paidWithdrawalCountsTowardBalance)
          .reduce((s, w) => s + w.amount, 0),
        withdrawals: latestWithdrawals
          .slice()
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      },
      kpayPhone,
    );

    if (record.status === "paid") {
      return c.json({
        success: true,
        message: "Commission sent to your KBZPay wallet",
        withdrawal: record,
        wallet: refreshed,
      });
    }
    if (record.status === "processing") {
      return c.json({
        success: true,
        pending: true,
        message:
          payout.providerMessage ||
          "Payout submitted — KBZPay is processing. Check back shortly.",
        withdrawal: record,
        wallet: refreshed,
      });
    }

    return c.json({
      success: false,
      error: record.errorMessage || "KBZPay payout failed",
      withdrawal: record,
      wallet: refreshed,
    });
  } catch (error: unknown) {
    console.error("postVendorCommissionWithdraw error", error);
    return c.json({ error: "Failed to process withdrawal" }, 500);
  }
}
