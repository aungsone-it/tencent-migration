/**
 * KBZ PWA: persist checkout draft server-side and create storefront orders after payment.
 * localStorage is often empty when KBZPay returns in its in-app WebView.
 */
import * as kv from "./kv_store.tsx";
import { normalizeOrderShippingFields, applyNormalizedShippingToOrderBody } from "./order_shipping.ts";
import { slimOrderCreateBody } from "./order_create_slim.ts";
import { canonicalizeOrderNumber } from "./order_number.ts";
import { syncOrderReadModel } from "./read_model.ts";
import { resolveCanonicalVendorId } from "./vendor_id_resolve.ts";

const DRAFT_KEY_PREFIX = "kpay_pwa_draft:";

export function resolveMerchantOrderIdFromOrder(order: Record<string, unknown>): string {
  const kpay =
    order.kpay && typeof order.kpay === "object"
      ? (order.kpay as Record<string, unknown>)
      : undefined;
  const fromKpay = text(kpay?.merchantOrderId);
  if (fromKpay) return fromKpay;
  const orderNumber = text(order.orderNumber);
  if (/^(ORD|MOS|NOS)-/i.test(orderNumber)) return orderNumber;
  return "";
}

export async function deletePwaCheckoutDraft(merchantOrderId: string): Promise<void> {
  const id = text(merchantOrderId);
  if (!id) return;
  await kv.del(`${DRAFT_KEY_PREFIX}${id}`).catch(() => undefined);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso(): string {
  return new Date().toISOString();
}

export function parsePwaCallbackInfo(
  raw: unknown,
): { storefrontOrigin?: string; summaryPath?: string } | null {
  const s = text(raw);
  if (!s) return null;
  try {
    const decoded = s.includes("%") ? decodeURIComponent(s) : s;
    const params = new URLSearchParams(
      decoded.includes("so=") || decoded.includes("storefrontOrigin=") ? decoded : s,
    );
    const origin = text(params.get("so")) || text(params.get("storefrontOrigin"));
    if (origin) {
      const sp = text(params.get("sp")) || text(params.get("summaryPath"));
      return { storefrontOrigin: origin, summaryPath: sp || undefined };
    }
    const json = JSON.parse(decoded) as Record<string, unknown>;
    const fromJson = text(json.so) || text(json.storefrontOrigin);
    if (fromJson) {
      return {
        storefrontOrigin: fromJson,
        summaryPath: text(json.sp) || text(json.summaryPath) || undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function enrichPwaDraftWithCallback(
  draft: PwaCheckoutDraftRecord | null,
  callbackInfo: string,
): PwaCheckoutDraftRecord | null {
  const parsed = parsePwaCallbackInfo(callbackInfo);
  if (!parsed?.storefrontOrigin) return draft;
  if (!draft) {
    return {
      merchantOrderId: "",
      summaryPath: parsed.summaryPath,
      storefrontOrigin: parsed.storefrontOrigin,
      savedAt: nowIso(),
    };
  }
  return {
    ...draft,
    storefrontOrigin: text(draft.storefrontOrigin) || parsed.storefrontOrigin,
    summaryPath: text(draft.summaryPath) || parsed.summaryPath,
  };
}

export type PwaCheckoutDraftRecord = {
  merchantOrderId: string;
  prepayId?: string;
  originPath?: string;
  /** e.g. `/summary` on vendor host or `/vendor/go-go/summary` on marketplace */
  summaryPath?: string;
  /** Storefront origin where checkout started, e.g. `https://gogo.walwal.online` */
  storefrontOrigin?: string;
  draftOrder?: Record<string, unknown>;
  savedAt: string;
};

/** Absolute URL for post-payment summary — always unified apex (`walwal.online/summary`). */
export function buildPwaSummaryAbsoluteUrl(
  draft: PwaCheckoutDraftRecord | null,
  fallbackSpaBase: string,
  prepayId: string,
  merchantOrderId: string,
): string {
  const qs = new URLSearchParams();
  if (prepayId) qs.set("prepay_id", prepayId);
  if (merchantOrderId) qs.set("merch_order_id", merchantOrderId);
  const q = qs.toString();

  // Summary UI lives on the unified return host. `draft.storefrontOrigin` is only
  // used client-side for "Continue Shopping" back to the vendor storefront.
  void draft;
  let spaOrigin = "";
  try {
    spaOrigin = new URL(fallbackSpaBase).origin;
  } catch {
    spaOrigin = String(fallbackSpaBase || "").trim().replace(/\/$/, "");
  }
  const path = "/summary";
  return q ? `${spaOrigin}${path}?${q}` : `${spaOrigin}${path}`;
}

export async function savePwaCheckoutDraft(record: PwaCheckoutDraftRecord): Promise<void> {
  const id = text(record.merchantOrderId);
  if (!id) return;
  await kv.set(`${DRAFT_KEY_PREFIX}${id}`, {
    ...record,
    merchantOrderId: id,
    savedAt: record.savedAt || nowIso(),
  });
}

function orderIdLookupVariants(id: string): string[] {
  const trimmed = text(id).toUpperCase();
  if (!trimmed) return [];
  const match = trimmed.match(/^(ORD|MOS|NOS)-(.+)$/);
  if (!match) return [trimmed];
  const code = match[2];
  return [`ORD-${code}`, `MOS-${code}`, `NOS-${code}`];
}

export async function getPwaCheckoutDraft(
  merchantOrderId: string,
): Promise<PwaCheckoutDraftRecord | null> {
  const variants = [
    ...new Set([text(merchantOrderId), ...orderIdLookupVariants(merchantOrderId)]),
  ];
  let draftFromKey: PwaCheckoutDraftRecord | null = null;
  for (const id of variants) {
    if (!id) continue;
    const row = (await kv.get(`${DRAFT_KEY_PREFIX}${id}`)) as PwaCheckoutDraftRecord | null;
    if (row && typeof row === "object") {
      draftFromKey = row;
      break;
    }
  }

  let txn: Record<string, unknown> | null = null;
  for (const id of variants) {
    if (!id) continue;
    const row = (await kv.get(`kpay_txn:${id}`)) as Record<string, unknown> | null;
    if (row && typeof row === "object") {
      txn = row;
      break;
    }
  }
  const txnDraft = checkoutDraftFromTxn(text(merchantOrderId), txn);

  if (draftFromKey) {
    if (!draftFromKey.draftOrder && txnDraft?.draftOrder) {
      return {
        ...draftFromKey,
        draftOrder: txnDraft.draftOrder,
        prepayId: text(draftFromKey.prepayId) || txnDraft.prepayId,
        savedAt: text(draftFromKey.savedAt) || txnDraft.savedAt,
      };
    }
    return draftFromKey;
  }
  return txnDraft;
}

function looksLikeBadRecoveryCustomerName(value: string): boolean {
  const v = value.trim();
  if (!v || v.length < 2) return true;
  if (v.startsWith("/")) return true;
  if (/^https?:\/\//i.test(v)) return true;
  return false;
}

function isKpayQrTxn(txn: Record<string, unknown> | null | undefined): boolean {
  if (!txn || typeof txn !== "object") return false;
  const method = text(txn.method).toLowerCase();
  const tradeType = text(txn.tradeType).toUpperCase();
  return method === "qr" || tradeType === "PAY_BY_QRCODE";
}

function resolveKpayOrderLabels(txn: Record<string, unknown> | null): {
  paymentMethod: string;
  kpayMethod: string;
} {
  if (isKpayQrTxn(txn)) {
    return { paymentMethod: "KBZPay", kpayMethod: "qr" };
  }
  return { paymentMethod: "KBZPay (PWA)", kpayMethod: "pwa" };
}

function resolveRecoveryCustomerName(
  draftName: unknown,
  shipFullName: unknown,
  email: unknown,
): string {
  const candidates = [
    text(shipFullName),
    text(draftName),
    text(email).split("@")[0] || "",
    "KBZPay Guest",
  ];
  for (const c of candidates) {
    if (!looksLikeBadRecoveryCustomerName(c)) return c;
  }
  return "KBZPay Guest";
}

function buildOrderBodyFromDraft(
  merchantOrderId: string,
  draft: PwaCheckoutDraftRecord,
  txn: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const d = draft.draftOrder;
  if (!d || typeof d !== "object") return null;
  const ship =
    d.shippingInfo && typeof d.shippingInfo === "object"
      ? (d.shippingInfo as Record<string, unknown>)
      : {};

  const shipping = normalizeOrderShippingFields({
    address: ship.address || "",
    city: ship.city || "",
    state: ship.state || "",
    zipCode: ship.zipCode || ship.sellerId || "",
    sellerId: ship.sellerId || ship.zipCode || "",
    country: ship.country || "",
  });

  const customerName = resolveRecoveryCustomerName(d.customerName, ship.fullName, d.email);
  const shippingFee = Number(d.shippingFee ?? d.shippingCost ?? d.shipping ?? 0) || 0;
  const { paymentMethod, kpayMethod } = resolveKpayOrderLabels(txn);

  return {
    orderNumber: merchantOrderId,
    userId: d.userId ?? null,
    customer: customerName,
    customerName,
    email: d.email || "",
    phone: d.phone || ship.phone || "",
    status: "pending",
    paymentStatus: "paid",
    paymentMethod,
    total: Number(d.total || 0),
    subtotal: Number(d.subtotal || 0),
    discount: Number(d.discount || 0),
    shippingFee,
    shippingCost: Number(d.shippingCost ?? d.shippingFee ?? d.shipping ?? shippingFee) || 0,
    shipping: Number(d.shipping ?? d.shippingFee ?? d.shippingCost ?? shippingFee) || 0,
    checkoutFreeShipping: d.checkoutFreeShipping === true,
    deliveryPartnerId: d.deliveryPartnerId ?? null,
    deliveryPartnerName: d.deliveryPartnerName ?? null,
    deliveryService: d.deliveryService ?? d.deliveryPartnerName ?? null,
    estimatedDelivery: d.estimatedDelivery ?? null,
    codFee: Number(d.codFee ?? 0) || 0,
    date: nowIso(),
    vendor: d.vendor || "",
    vendorId: d.vendorId || undefined,
    couponCode: d.couponCode || null,
    couponId: d.couponId || null,
    couponDiscount: Number(d.discount || 0),
    items: Array.isArray(d.items) ? d.items : [],
    address: shipping.address,
    city: shipping.city,
    state: shipping.state,
    zipCode: shipping.zipCode,
    sellerId: shipping.sellerId,
    country: shipping.country,
    shippingAddress: shipping.shippingAddress,
    notes: d.notes || "",
    kpay: {
      method: kpayMethod,
      merchantOrderId,
      prepayId: text(txn?.prepayId) || text(draft.prepayId) || "",
      status: "paid",
      providerStatus: text(txn?.providerStatus) || "paid",
      payUrl: text(txn?.payUrl) || "",
      ...(kpayMethod === "qr"
        ? {
            qrContent: text(txn?.qrContent) || "",
            qrImageUrl: text(txn?.qrImageUrl) || "",
          }
        : {}),
    },
  };
}

function checkoutDraftFromTxn(
  merchantOrderId: string,
  txn: Record<string, unknown> | null,
): PwaCheckoutDraftRecord | null {
  const draftOrder = txn?.draftOrder;
  if (!draftOrder || typeof draftOrder !== "object") return null;
  return {
    merchantOrderId,
    prepayId: text(txn?.prepayId) || undefined,
    draftOrder: draftOrder as Record<string, unknown>,
    savedAt: text(txn?.paidAt) || text(txn?.createdAt) || nowIso(),
  };
}

function buildOrderBodyFromPaidTxn(
  merchantOrderId: string,
  txn: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const fromTxnDraft = checkoutDraftFromTxn(merchantOrderId, txn);
  if (fromTxnDraft) {
    const body = buildOrderBodyFromDraft(merchantOrderId, fromTxnDraft, txn);
    if (body) return body;
  }
  if (!txn || typeof txn !== "object") return null;
  const total = Number(txn.amount || 0) || 0;
  const { paymentMethod, kpayMethod } = resolveKpayOrderLabels(txn);
  const title = text(txn.title) || (kpayMethod === "qr" ? "KBZPay QR" : "KBZPay PWA");
  return {
    orderNumber: merchantOrderId,
    userId: null,
    customer: "KBZPay Guest",
    customerName: "KBZPay Guest",
    email: "",
    phone: "",
    status: "pending",
    paymentStatus: "paid",
    paymentMethod,
    total,
    subtotal: total,
    discount: 0,
    shippingFee: 0,
    shippingCost: 0,
    shipping: 0,
    date: nowIso(),
    vendor: "",
    items: [{ name: title, quantity: 1, price: total, subtotal: total }],
    address: "",
    city: "",
    state: "",
    zipCode: "",
    country: "",
    notes: "Recovered from paid KBZPay transaction (checkout draft missing)",
    kpay: {
      method: kpayMethod,
      merchantOrderId,
      prepayId: text(txn.prepayId) || "",
      status: "paid",
      providerStatus: text(txn.providerStatus) || "PAY_SUCCESS",
      adminRecovered: true,
      recoveredWithoutDraft: true,
    },
  };
}

async function applyResolvedVendorToOrderBody(body: Record<string, unknown>): Promise<void> {
  const candidate = text(body.vendorId) || text(body.vendor);
  const resolved = candidate ? await resolveCanonicalVendorId(candidate) : "";
  if (!resolved) return;
  body.vendorId = resolved;
  if (!Array.isArray(body.items)) return;
  body.items = body.items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = { ...(item as Record<string, unknown>) };
    const existing = text(row.vendorId) || text(row.vendor);
    const itemId = existing.startsWith("vendor_") ? existing : resolved;
    row.vendorId = itemId;
    if (!text(row.vendor)) row.vendor = itemId;
    return row;
  });
}

async function createStorefrontOrderDirect(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  const requestedOrderNumber = canonicalizeOrderNumber(
    text(body.orderNumber) ||
      text((body.kpay as Record<string, unknown> | undefined)?.merchantOrderId),
  );
  if (requestedOrderNumber) {
    body.orderNumber = requestedOrderNumber;
  }

  if (requestedOrderNumber) {
    const mappedId = await kv.get(`order_num:${requestedOrderNumber}`);
    if (typeof mappedId === "string" && mappedId.trim()) {
      const existing = (await kv.get(`order:${mappedId.trim()}`)) as Record<string, unknown> | null;
      if (existing) {
        return { ok: true, status: 200, order: existing };
      }
    }
  }

  const deterministicOrderId = requestedOrderNumber
    ? `order_ref_${encodeURIComponent(requestedOrderNumber)}`
    : "";
  const id =
    deterministicOrderId ||
    `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const parsedTotal =
    typeof body.total === "string" ? parseFloat(body.total) : (Number(body.total) || 0);
  const parsedSubtotal = body.subtotal
    ? typeof body.subtotal === "string"
      ? parseFloat(body.subtotal)
      : Number(body.subtotal)
    : parsedTotal;
  const parsedDiscount = body.discount
    ? typeof body.discount === "string"
      ? parseFloat(body.discount)
      : Number(body.discount)
    : 0;
  const parsedShippingFee = Number(body.shippingFee ?? body.shippingCost ?? body.shipping ?? 0) || 0;

  const orderData = {
    ...applyNormalizedShippingToOrderBody(slimOrderCreateBody(body)),
    orderNumber: requestedOrderNumber || text(body.orderNumber),
    id,
    total: parsedTotal,
    subtotal: parsedSubtotal,
    discount: parsedDiscount,
    shippingFee: parsedShippingFee,
    shippingCost: parsedShippingFee,
    shipping: parsedShippingFee,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    date: text(body.date) || new Date().toISOString().split("T")[0],
    paymentStatus: text(body.paymentStatus) || "unpaid",
    shippingStatus: text(body.shippingStatus) || "pending",
    inventoryDeducted: false,
  };

  await kv.set(`order:${id}`, orderData);
  if (requestedOrderNumber) {
    await kv.set(`order_num:${requestedOrderNumber}`, id);
  }

  try {
    await syncOrderReadModel(id, orderData);
  } catch {
    /* KV is source of truth; SQL sync is best-effort */
  }

  return { ok: true, status: 201, order: orderData };
}

async function persistStorefrontOrder(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  try {
    const viaHttp = await postStorefrontOrder(body);
    if (viaHttp.ok) return viaHttp;
    console.warn(
      "postStorefrontOrder failed, falling back to direct create:",
      viaHttp.error || viaHttp.message || viaHttp.status,
    );
  } catch (error) {
    console.warn("postStorefrontOrder threw, falling back to direct create:", error);
  }
  return createStorefrontOrderDirect(body);
}

async function postStorefrontOrder(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  const base =
    text(Deno.env.get("CLOUDBASE_API_BASE_URL")) ||
    text(Deno.env.get("TENCENT_API_BASE_URL"));
  const key =
    text(Deno.env.get("CLOUDBASE_SERVICE_TOKEN")) ||
    text(Deno.env.get("TCB_SERVICE_TOKEN")) ||
    text(Deno.env.get("CLOUDBASE_PUBLISHABLE_KEY"));
  if (!base || !key) {
    return { ok: false, status: 500, error: "cloudbase_env_missing" };
  }
  const url = `${base.replace(/\/$/, "")}/orders`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(slimOrderCreateBody(body)),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: text(data.error) || "create_failed",
      message: text(data.message) || text(data.error),
    };
  }
  const order = data.order;
  return {
    ok: true,
    status: res.status,
    order: order && typeof order === "object" ? (order as Record<string, unknown>) : undefined,
  };
}

/** Create storefront order when KBZ txn is paid and draft exists. Idempotent. */
export async function finalizePwaCheckoutOrder(
  merchantOrderId: string,
  options?: { adminRecover?: boolean },
): Promise<{
  ok: boolean;
  created?: boolean;
  duplicate?: boolean;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  const id = text(merchantOrderId);
  if (!id) return { ok: false, error: "merchant_order_id_required" };
  const canonicalId = canonicalizeOrderNumber(id) || id;

  for (const lookup of [...new Set([id, canonicalId])]) {
    const mapped = await kv.get(`order_num:${lookup}`);
    if (typeof mapped === "string" && mapped.trim()) {
      const existing = (await kv.get(`order:${mapped.trim()}`)) as Record<string, unknown> | null;
      if (existing) {
        // Keep the draft so the KBZ return WebView can still render the summary.
        return { ok: true, created: false, duplicate: true, order: existing };
      }
    }
  }

  const draft = await getPwaCheckoutDraft(id);
  const txn = (await kv.get(`kpay_txn:${id}`)) as Record<string, unknown> | null;
  const txnDraft = checkoutDraftFromTxn(id, txn);
  const snapshot = draft?.draftOrder ? draft : txnDraft;
  const txnStatus = text(txn?.status).toLowerCase();
  if (txnStatus !== "paid") {
    return { ok: false, error: "payment_not_confirmed", message: txnStatus || "pending" };
  }

  if (!snapshot?.draftOrder && !options?.adminRecover) {
    return { ok: false, error: "no_checkout_draft" };
  }

  const body = snapshot?.draftOrder
    ? buildOrderBodyFromDraft(id, snapshot, txn)
    : buildOrderBodyFromPaidTxn(id, txn);
  if (!body) return { ok: false, error: "invalid_draft" };

  if (options?.adminRecover) {
    const kpay =
      body.kpay && typeof body.kpay === "object"
        ? (body.kpay as Record<string, unknown>)
        : {};
    body.kpay = {
      ...kpay,
      adminRecovered: true,
      recoveredAt: nowIso(),
    };
  }

  await applyResolvedVendorToOrderBody(body);

  const result = await persistStorefrontOrder(body);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: result.message,
    };
  }

  return {
    ok: true,
    created: true,
    duplicate: result.status === 200,
    order: result.order,
  };
}
