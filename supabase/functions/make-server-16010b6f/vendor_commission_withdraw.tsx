import { Context } from "hono";
import * as kv from "./kv_store.tsx";
import { invokeKPayBusinessPay } from "./kpay_routes.tsx";

type AnyRecord = Record<string, unknown>;

const WITHDRAWABLE_STATUSES = new Set(["ready-to-ship", "fulfilled", "shipped", "delivered"]);

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
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeOrderStatus(status: unknown): string {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
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

function lineCommissionPercent(
  item: AnyRecord,
  productMap: Map<string, { commissionRate: unknown }>,
  defaultVendorPercent: number,
): number {
  const fromLine = parseCommissionPercent(
    item.commissionRate ?? item.commission ?? (item.product as AnyRecord | undefined)?.commissionRate,
  );
  if (fromLine > 0) return fromLine;

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
    if (hit) {
      const pct = parseCommissionPercent(hit.commissionRate);
      if (pct > 0) return pct;
    }
  }
  return defaultVendorPercent;
}

function isOrderWithdrawable(order: AnyRecord): boolean {
  if (!order || typeof order !== "object") return false;
  const st = normalizeOrderStatus(order.status);
  if (st === "cancelled") return false;
  return WITHDRAWABLE_STATUSES.has(st);
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
  catalog: { ids: Set<string>; skus: Set<string> },
): boolean {
  const vid = String(vendorId ?? "").trim();
  if (!vid || item == null) return false;

  const idCandidates = [item.vendorId, item.vendor, (item.product as AnyRecord | undefined)?.vendorId].filter(
    (x) => x != null && String(x).trim() !== "",
  );
  if (idCandidates.some((x) => String(x).trim() === vid)) return true;

  const sel = (item.product as AnyRecord | undefined)?.selectedVendors ?? item.selectedVendors;
  if (Array.isArray(sel) && sel.some((x: unknown) => String(x).trim() === vid)) return true;

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
  const top = [order.vendorId, order.vendor, order.vendorName].filter(
    (x) => x != null && String(x).trim() !== "",
  );
  if (top.some((x) => vendorIds.has(String(x).trim()))) return true;
  return false;
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
    if (vendor.email) ids.add(String(vendor.email));
    if (vendor.storeSlug) ids.add(String(vendor.storeSlug));
    if (vendor.name) ids.add(String(vendor.name));
    if (vendor.businessName) ids.add(String(vendor.businessName));
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

function buildProductMap(products: AnyRecord[]): Map<string, { commissionRate: unknown }> {
  const map = new Map<string, { commissionRate: unknown }>();
  for (const product of products) {
    if (!product?.id) continue;
    const info = {
      commissionRate:
        product.commissionRate !== undefined && product.commissionRate !== null
          ? product.commissionRate
          : 0,
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

    for (const item of items) {
      if (!lineItemBelongsToVendor(item as AnyRecord, vendorId, catalog)) continue;
      matchedAnyLine = true;
      const gross = orderLineGross(item as AnyRecord);
      const net = orderLineNetAfterDiscount(gross, order);
      const pct = lineCommissionPercent(item as AnyRecord, productMap, defaultCommissionPercent);
      const platformComm = (net * pct) / 100;
      payout += Math.max(0, net - platformComm);
    }

    // Single-vendor order with no line-level vendor tags — attribute whole order when top-level vendor matches.
    if (!matchedAnyLine && items.length > 0 && orderBelongsToVendor(order, vendorIds)) {
      const orderTotal = parseMoney(order.total);
      const orderSub = parseMoney(order.subtotal) || orderTotal;
      let orderCommission = 0;
      for (const item of items) {
        const gross = orderLineGross(item as AnyRecord);
        const net = orderLineNetAfterDiscount(gross, order);
        const pct = lineCommissionPercent(item as AnyRecord, productMap, defaultCommissionPercent);
        orderCommission += (net * pct) / 100;
      }
      payout += Math.max(0, orderTotal - orderCommission);
    }
  }

  return Math.round(payout * 100) / 100;
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

async function listVendorWithdrawals(vendorId: string): Promise<VendorWithdrawalRecord[]> {
  const rows = (await kv.get(`vendor_withdrawals:${vendorId}`)) as VendorWithdrawalRecord[] | null;
  return Array.isArray(rows) ? rows : [];
}

async function saveVendorWithdrawals(vendorId: string, rows: VendorWithdrawalRecord[]): Promise<void> {
  await kv.set(`vendor_withdrawals:${vendorId}`, rows);
}

function withdrawnTotal(rows: VendorWithdrawalRecord[]): number {
  return rows
    .filter((r) => r.status === "paid" || r.status === "processing" || r.status === "pending")
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

function minWithdrawAmountMmk(): number {
  const raw = Number(Deno.env.get("VENDOR_WITHDRAW_MIN_MMK") || "1");
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 1;
}

async function computeVendorWallet(vendorId: string) {
  const vendor = (await kv.get(`vendor:${vendorId}`)) as AnyRecord | null;
  if (!vendor) {
    return null;
  }

  const vendorIds = await resolveVendorIdentifierSet(vendorId);
  const defaultCommissionPercent = parseCommissionPercent(vendor.commission) || 15;

  const [orders, products, withdrawals] = await Promise.all([
    kv.getByPrefix("order:").catch(() => [] as AnyRecord[]),
    kv.getByPrefix("product:").catch(() => [] as AnyRecord[]),
    listVendorWithdrawals(vendorId),
  ]);

  const validOrders = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const validProducts = (Array.isArray(products) ? products.filter(Boolean) : []).filter((p) =>
    productBelongsToVendor(p as AnyRecord, vendorIds)
  );
  const totalEarned = computeVendorAccruedPayout(
    validOrders,
    validProducts,
    vendorId,
    vendorIds,
    defaultCommissionPercent,
  );
  const reserved = withdrawnTotal(withdrawals);
  const availableBalance = Math.max(0, Math.round((totalEarned - reserved) * 100) / 100);

  return {
    vendorId,
    vendorName: text(vendor.businessName) || text(vendor.name) || vendorId,
    kpayPhone: text(vendor.kpayPhone) || text(vendor.kpayAccount) || "",
    totalEarned,
    totalWithdrawn: withdrawals.filter((w) => w.status === "paid").reduce((s, w) => s + w.amount, 0),
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

export async function getVendorCommissionWallet(c: Context) {
  try {
    const vendorId = text(c.req.param("vendorId"));
    if (!vendorId) return c.json({ error: "vendorId is required" }, 400);

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

    const body = (await c.req.json().catch(() => ({}))) as AnyRecord;
    const wallet = await computeVendorWallet(vendorId);
    if (!wallet) return c.json({ error: "Vendor not found" }, 404);

    const kpayPhone =
      normalizeMyanmarKpayPhone(body.kpayPhone ?? body.kpayAccount) ||
      normalizeMyanmarKpayPhone(wallet.kpayPhone);
    if (!kpayPhone) {
      return c.json({ error: "KBZPay phone number is required" }, 400);
    }

    const requestedAmount =
      body.amount != null && body.amount !== ""
        ? Math.round(parseMoney(body.amount))
        : Math.round(wallet.availableBalance);

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

    const withdrawals = await listVendorWithdrawals(vendorId);
    const inflight = withdrawals.find((w) => w.status === "pending" || w.status === "processing");
    if (inflight) {
      return c.json(
        {
          error: "A withdrawal is already in progress. Please wait for it to complete.",
          withdrawal: inflight,
        },
        409,
      );
    }

    const merchOrderId = makeMerchOrderId(vendorId);
    const withdrawalId = crypto.randomUUID();
    const createdAt = nowIso();
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

    withdrawals.unshift(pendingRecord);
    await saveVendorWithdrawals(vendorId, withdrawals);

    const vendor = (await kv.get(`vendor:${vendorId}`)) as AnyRecord | null;
    if (vendor) {
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
        pending: false,
        merchantOrderId: merchOrderId,
        providerMessage: String((kpayErr as Error)?.message || kpayErr || "KBZPay payout error"),
        networkError: "KBZPay request failed",
      };
    }

    const idx = withdrawals.findIndex((w) => w.id === withdrawalId);
    if (idx < 0) return c.json({ error: "Withdrawal record lost" }, 500);

    const updatedAt = nowIso();
    if (payout.success) {
      withdrawals[idx] = {
        ...withdrawals[idx],
        status: "paid",
        updatedAt,
        paidAt: updatedAt,
        kbz: {
          paymentOrderId: payout.paymentOrderId,
          mmOrderId: payout.mmOrderId,
          tradeStatus: payout.tradeStatus,
          endpointUsed: payout.endpointUsed,
          rawResponse: payout.rawResponse,
        },
      };
    } else if (payout.pending) {
      withdrawals[idx] = {
        ...withdrawals[idx],
        status: "processing",
        updatedAt,
        kbz: {
          paymentOrderId: payout.paymentOrderId,
          mmOrderId: payout.mmOrderId,
          tradeStatus: payout.tradeStatus,
          endpointUsed: payout.endpointUsed,
          rawResponse: payout.rawResponse,
          providerMessage: payout.providerMessage,
        },
      };
    } else {
      withdrawals[idx] = {
        ...withdrawals[idx],
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
    }

    await saveVendorWithdrawals(vendorId, withdrawals);
    await kv.set(`vendor_withdrawal_txn:${merchOrderId}`, withdrawals[idx]);

    const record = withdrawals[idx];
    const sortedWithdrawals = withdrawals
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const reservedAfter = withdrawnTotal(withdrawals);
    const refreshed = {
      ...wallet,
      reservedBalance: reservedAfter,
      availableBalance: Math.max(0, Math.round((wallet.totalEarned - reservedAfter) * 100) / 100),
      totalWithdrawn: withdrawals
        .filter((w) => w.status === "paid")
        .reduce((s, w) => s + w.amount, 0),
      withdrawals: sortedWithdrawals,
      kpayPhone,
    };

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

    // Always return 200 so CloudBase does not replace our JSON with a bare gateway 502.
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
