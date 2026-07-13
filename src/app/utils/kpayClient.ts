import { resolveVendorPathSlug } from "./vendorStorePaths";
import {
  isLocalDevHostname,
  isMarketplaceApexHost,
  resolveActiveVendorSubdomainBase,
  resolvePrimaryPlatformApexHost,
  resolveVendorSubdomainApexFromHost,
} from "./platformApexHost";
import {
  cloudbaseApiBaseUrl,
  cloudbasePublishableKey,
  getCloudBaseRequestHeaders,
} from "../../../utils/supabase/info";

export type KPaySession = {
  merchantOrderId: string;
  status: "pending" | "paid" | "failed";
  providerStatus?: string;
  qrContent?: string;
  qrImageUrl?: string;
  payUrl?: string;
  stale?: boolean;
  debug?: {
    endpointUsed?: string;
    queryEndpointUsed?: string;
    signMode?: string;
    wrapRequest?: boolean;
    signSource?: string;
    sign?: string;
    signedPayload?: Record<string, unknown>;
    providerTopLevelKeys?: string[];
    providerNestedKeys?: string[];
    providerCode?: string;
    providerMessage?: string;
    networkError?: string;
    httpStatus?: number;
    attemptedEndpoints?: string[];
    rawResponse?: Record<string, unknown>;
    stale?: boolean;
  };
};

type KPayBaseParams = {
  projectId: string;
  publicAnonKey: string;
};

const API_ROOT = cloudbaseApiBaseUrl;

function cloudbaseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
    ...extra,
  };
}

type CreateKPayQrParams = KPayBaseParams & {
  amount: number;
  merchantOrderId?: string;
  currency?: string;
  /**
   * Legacy display label. Kept for callers that still pass it,
   * but no longer forwarded to the server: KBZ PGW `precreate` for `PAY_BY_QRCODE`
   * does not accept arbitrary biz_content fields like `title` and rejects them
   * with `AOP04502` (signature/biz validation failure).
   */
  title?: string;
  notifyUrl?: string;
};

function deriveUiStatus(rawStatus: unknown, rawProviderStatus: unknown): "pending" | "paid" | "failed" {
  const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase();
  const status = normalize(rawStatus);
  const provider = normalize(rawProviderStatus);
  const merged = [status, provider];

  if (
    merged.some((v) =>
      [
        "PAID",
        "SUCCESS",
        "PAY_SUCCESS",
        "TRADE_SUCCESS",
        "COMPLETED",
        "PAYED",
        "TRANSACTION_SUCCESS",
        "00",
      ].includes(v),
    )
  ) {
    return "paid";
  }
  if (
    merged.some((v) =>
      [
        "FAILED",
        "FAIL",
        "PAY_FAILED",
        "TRADE_FAIL",
        "TRADE_CLOSED",
        "ORDER_CLOSED",
        "ORDER_EXPIRED",
        "EXPIRED",
        "CANCELLED",
        "TRANSACTION_FAILED",
      ].includes(v),
    )
  ) {
    return "failed";
  }
  return "pending";
}

function isLikelyImageUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (v.startsWith("data:image/")) return true;
  if (!v.startsWith("http")) return false;
  return (
    v.includes("api.qrserver.com") ||
    v.includes("qrcode") ||
    v.includes("qr-code") ||
    v.endsWith(".png") ||
    v.endsWith(".jpg") ||
    v.endsWith(".jpeg") ||
    v.endsWith(".gif") ||
    v.endsWith(".webp") ||
    v.endsWith(".svg")
  );
}

// Customer-facing pay URL must look like a real KBZPay deeplink or H5/PWA URL
// — NOT just "any http://… string", which used to match `notify_url`,
// `endpointUsed`, and the gateway URL we POST to. For QR-mode `precreate`
// KBZ doesn't return a customer pay URL at all, so this stays empty.
function isLikelyCustomerPayUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (v.startsWith("kbzpay://")) return true;
  if (!v.startsWith("http")) return false;
  return (
    v.includes("wap.kbzpay.com") ||
    v.includes("kbzpay.com") ||
    v.includes("/cashier") ||
    v.includes("/h5") ||
    v.includes("/pay/")
  );
}

const PAY_URL_KEYS = new Set([
  "payurl",
  "paymenturl",
  "pay_url",
  "payment_url",
  "deeplink",
  "deep_link",
  "prepayurl",
  "prepay_url",
  "cashierurl",
  "cashier_url",
  "h5url",
  "h5_url",
  "redirecturl",
  "redirect_url",
]);

function deepExtractPayload(
  value: unknown,
): { qrContent?: string; qrImageUrl?: string; payUrl?: string; merchantOrderId?: string; providerStatus?: string } {
  const out: { qrContent?: string; qrImageUrl?: string; payUrl?: string; merchantOrderId?: string; providerStatus?: string } = {};
  const visit = (node: unknown) => {
    if (!node || (out.qrContent && out.qrImageUrl && out.payUrl && out.merchantOrderId)) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const lowerKeys = Object.keys(rec);

    for (const key of lowerKeys) {
      const raw = rec[key];
      const val = typeof raw === "string" ? raw.trim() : "";
      const lk = key.toLowerCase();

      if (!out.merchantOrderId && val && ["merchantorderid", "merch_order_id", "merchorderid", "outtradeno"].includes(lk)) {
        out.merchantOrderId = val;
      }
      if (!out.providerStatus && val && ["providerstatus", "tradestatus", "orderstatus", "status", "code", "resultcode"].includes(lk)) {
        out.providerStatus = val;
      }
      if (!val) continue;

      if (!out.qrImageUrl && isLikelyImageUrl(val)) {
        out.qrImageUrl = val;
      }
      // Only accept payUrl when the KEY itself signals it's a customer pay URL.
      // Without this gate, any random `http://…` field (notify_url, endpointUsed,
      // signedPayload echoes) would get hijacked as a clickable "pay" link.
      if (!out.payUrl && PAY_URL_KEYS.has(lk) && isLikelyCustomerPayUrl(val)) {
        out.payUrl = val;
      }
      if (
        !out.qrContent &&
        [
          "qrcontent",
          "qrcode",
          "qr_code",
          "qrstring",
          "codeurl",
          "code_url",
          "rawqr",
          "code_content",
          "codecontent",
        ].includes(lk)
      ) {
        out.qrContent = val;
      }
    }

    for (const child of Object.values(rec)) {
      if (typeof child === "string") {
        const v = child.trim();
        if (!v) continue;
        if (!out.qrImageUrl && isLikelyImageUrl(v)) out.qrImageUrl = v;
        // Intentionally NO payUrl pickup here — see the key-gated pass above.
      } else if (typeof child === "object") {
        visit(child);
      }
    }
  };
  visit(value);
  return out;
}

function normalizeSession(data: Record<string, any>, fallbackOrderId: string): KPaySession {
  const extracted = deepExtractPayload(data);
  const qrImageCandidate = String(data.qrImageUrl || extracted.qrImageUrl || "").trim();
  const qrImageUrl = isLikelyImageUrl(qrImageCandidate) ? qrImageCandidate : "";
  const qrContent = String(data.qrContent || extracted.qrContent || "").trim();
  const payUrl = String(data.payUrl || extracted.payUrl || "").trim();
  const debugPayload = (data.debug && typeof data.debug === "object") ? data.debug as Record<string, any> : {};
  const topLevelKeys = Array.isArray(debugPayload.providerTopLevelKeys) ? debugPayload.providerTopLevelKeys : [];
  const nestedKeys = Array.isArray(debugPayload.providerNestedKeys) ? debugPayload.providerNestedKeys : [];
  const wrapFromPayload =
    typeof debugPayload.wrapRequest === "boolean"
      ? debugPayload.wrapRequest
      : typeof data.wrapRequest === "boolean"
        ? data.wrapRequest
        : false;
  const providerStatus = String(
    data.providerStatus ||
      extracted.providerStatus ||
      (data.debug && typeof data.debug === "object" ? (data.debug as Record<string, unknown>).providerCode : "") ||
      "",
  ).trim();
  return {
    merchantOrderId: String(data.merchantOrderId || extracted.merchantOrderId || fallbackOrderId),
    status: deriveUiStatus(data.status, providerStatus),
    providerStatus,
    qrContent,
    qrImageUrl,
    payUrl,
    stale: Boolean(data.stale ?? debugPayload.stale ?? false),
    debug: {
      endpointUsed: String(debugPayload.endpointUsed || data.endpointUsed || ""),
      queryEndpointUsed: String(debugPayload.queryEndpointUsed || data.queryEndpointUsed || ""),
      signMode: String(debugPayload.signMode || data.signMode || ""),
      wrapRequest: wrapFromPayload,
      signSource: String(debugPayload.signSource || data.signSource || ""),
      sign: String(debugPayload.sign || data.sign || ""),
      signedPayload:
        (debugPayload.signedPayload && typeof debugPayload.signedPayload === "object")
          ? (debugPayload.signedPayload as Record<string, unknown>)
          : (data.signedPayload && typeof data.signedPayload === "object")
            ? (data.signedPayload as Record<string, unknown>)
            : undefined,
      providerTopLevelKeys: topLevelKeys,
      providerNestedKeys: nestedKeys,
      providerCode: String(debugPayload.providerCode || data.providerStatus || ""),
      providerMessage: String(debugPayload.providerMessage || data.message || debugPayload.message || ""),
      networkError: String(debugPayload.networkError || ""),
      httpStatus: typeof debugPayload.httpStatus === "number" ? debugPayload.httpStatus : undefined,
      attemptedEndpoints: Array.isArray(debugPayload.attemptedEndpoints) ? debugPayload.attemptedEndpoints : [],
      rawResponse:
        (debugPayload.rawResponse && typeof debugPayload.rawResponse === "object")
          ? (debugPayload.rawResponse as Record<string, unknown>)
          : undefined,
      stale: Boolean(debugPayload.stale ?? data.stale ?? false),
    },
  };
}

function readProviderErrorDetails(data: Record<string, any>): {
  providerCode?: string;
  providerMessage?: string;
  endpoint?: string;
  signMode?: string;
  wrapRequest?: boolean;
} {
  const details = (data.details && typeof data.details === "object")
    ? (data.details as Record<string, any>)
    : {};
  const response = (details.Response && typeof details.Response === "object")
    ? (details.Response as Record<string, any>)
    : {};
  const nested = (
    (response.data && typeof response.data === "object" && (response.data as Record<string, any>)) ||
    (details.data && typeof details.data === "object" && (details.data as Record<string, any>)) ||
    {}
  );

  const providerCode = String(
    data.providerStatus ||
      data.code ||
      data.resultCode ||
      details.code ||
      details.resultCode ||
      details.respCode ||
      response.code ||
      response.resultCode ||
      response.respCode ||
      nested.code ||
      nested.resultCode ||
      nested.respCode ||
      "",
  ).trim();

  const providerMessage = String(
    data.message ||
      data.error_description ||
      details.message ||
      details.msg ||
      details.error ||
      response.message ||
      response.msg ||
      nested.message ||
      nested.msg ||
      nested.error ||
      "",
  ).trim();

  return {
    providerCode: providerCode || undefined,
    providerMessage: providerMessage || undefined,
    endpoint: String(data.endpoint || "").trim() || undefined,
    signMode: String(data.signMode || "").trim() || undefined,
    wrapRequest: typeof data.wrapRequest === "boolean" ? data.wrapRequest : undefined,
  };
}

export function buildMerchantOrderId(prefix = "ORD"): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function createKPayQrSession(params: CreateKPayQrParams): Promise<KPaySession> {
  const {
    projectId: _projectId,
    publicAnonKey: _publicAnonKey,
    amount,
    merchantOrderId = buildMerchantOrderId("KPAY"),
    currency = "MMK",
    notifyUrl,
  } = params;
  const response = await fetch(
    `${API_ROOT}/kpay/create-qr`,
    {
      method: "POST",
      headers: {
        ...cloudbaseHeaders({ "Content-Type": "application/json" }),
      },
      body: JSON.stringify({
        merchantOrderId,
        amount,
        currency,
        ...(notifyUrl ? { notifyUrl } : {}),
      }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const info = readProviderErrorDetails((data || {}) as Record<string, any>);
    const providerCode = info.providerCode || "";
    const providerMessage = info.providerMessage || "";

    // Return a structured "failed" session so the UI can show the real provider error.
    return {
      merchantOrderId: String(merchantOrderId),
      status: "failed",
      providerStatus: providerCode,
      qrContent: "",
      qrImageUrl: "",
      payUrl: "",
      debug: {
        endpointUsed: String(data?.endpoint || ""),
        queryEndpointUsed: "",
        signMode: String(data?.signMode || ""),
        wrapRequest: typeof data?.wrapRequest === "boolean" ? data.wrapRequest : undefined,
        signSource: String(data?.signSource || ""),
        sign: String(data?.sign || ""),
        signedPayload:
          (data?.signedPayload && typeof data.signedPayload === "object")
            ? (data.signedPayload as Record<string, unknown>)
            : undefined,
        providerTopLevelKeys: [],
        providerNestedKeys: [],
        providerCode,
        providerMessage,
      },
    };
  }
  const normalized = normalizeSession(data as Record<string, any>, merchantOrderId);
  if (!normalized.qrContent && !normalized.qrImageUrl && !normalized.payUrl) {
    console.warn("KBZPay create-qr returned no QR payload", data);
  }
  return normalized;
}

export async function fetchKPaySessionStatus(
  params: KPayBaseParams & { merchantOrderId: string },
): Promise<KPaySession> {
  const { projectId: _projectId, publicAnonKey: _publicAnonKey, merchantOrderId } = params;
  const response = await fetch(
    `${API_ROOT}/kpay/status/${encodeURIComponent(merchantOrderId)}`,
    {
      headers: cloudbaseHeaders(),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error || data?.message || "Failed to get KBZPay status"));
  }
  const normalized = normalizeSession(data as Record<string, any>, merchantOrderId);
  if (!normalized.qrContent && !normalized.qrImageUrl && !normalized.payUrl) {
    console.warn("KBZPay status returned no QR payload", data);
  }
  return normalized;
}

/* -------------------------------------------------------------------------- */
/* PWA flow                                                                   */
/* -------------------------------------------------------------------------- */
// Keys used to persist the in-flight PWA session across the KBZ redirect, so the
// /kpay/return SPA route can recover the merchantOrderId and the customer's cart
// once they come back from KBZPay.
export const KPAY_PWA_PENDING_STORAGE_KEY = "kpay_pwa_pending_order";

/** KBZ echoes `callback_info` on PWA return — survives in-app WebView when localStorage is cleared. */
export function buildPwaCallbackInfo(params: {
  storefrontOrigin: string;
  summaryPath?: string;
}): string {
  const origin = params.storefrontOrigin.trim().replace(/\/$/, "");
  if (!origin) return "";
  const qs = new URLSearchParams();
  qs.set("so", origin);
  const sp = (params.summaryPath || "/summary").trim();
  if (sp) qs.set("sp", sp.startsWith("/") ? sp : `/${sp}`);
  return qs.toString();
}

export function parsePwaCallbackInfo(
  raw: string | null | undefined,
): { storefrontOrigin?: string; summaryPath?: string } | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const decoded = s.includes("%") ? decodeURIComponent(s) : s;
    const params = new URLSearchParams(
      decoded.includes("so=") || decoded.includes("storefrontOrigin=") ? decoded : s,
    );
    const origin =
      params.get("so")?.trim() || params.get("storefrontOrigin")?.trim() || "";
    if (origin) {
      const sp = params.get("sp")?.trim() || params.get("summaryPath")?.trim();
      return { storefrontOrigin: origin, summaryPath: sp || undefined };
    }
    const json = JSON.parse(decoded) as Record<string, unknown>;
    const fromJson =
      (typeof json.so === "string" && json.so.trim()) ||
      (typeof json.storefrontOrigin === "string" && json.storefrontOrigin.trim()) ||
      "";
    if (fromJson) {
      const sp =
        (typeof json.sp === "string" && json.sp.trim()) ||
        (typeof json.summaryPath === "string" && json.summaryPath.trim()) ||
        "";
      return { storefrontOrigin: fromJson, summaryPath: sp || undefined };
    }
  } catch {
    /* ignore malformed callback_info */
  }
  return null;
}

function normalizePwaSummaryPath(path: string | null | undefined): string {
  const p = String(path ?? "").trim();
  if (!p || p === "/") return "/summary";
  return p.startsWith("/") ? p : `/${p}`;
}

/** Map a checkout (or return) pathname to its order-summary route. */
export function buildCheckoutSummaryPath(pathname: string): string {
  const path = (pathname.split("?")[0] || "").replace(/\/$/, "") || "/";
  if (path === "/summary" || path.endsWith("/summary")) return path;
  if (path === "/checkout") return "/summary";
  if (/\/checkout(?:\/success)?$/.test(path)) {
    return path.replace(/\/checkout(?:\/success)?$/, "/summary");
  }
  return "/summary";
}

/** Summary URL after KBZ PWA return — preserves vendor path from checkout `originPath`. */
export function buildKPaySummaryReturnUrl(params: {
  originPath?: string | null;
  merchantOrderId?: string;
  prepayId?: string;
}): string {
  return buildPwaSummaryAbsoluteUrl({
    storefrontOrigin: null,
    summaryPath: buildCheckoutSummaryPath(params.originPath || "/checkout"),
    merchantOrderId: params.merchantOrderId,
    prepayId: params.prepayId,
  });
}

function unifiedKpayReturnOrigin(): string {
  if (typeof window === "undefined") {
    const apex = resolvePrimaryPlatformApexHost();
    return apex ? `https://${apex}` : "https://localhost";
  }
  const host = window.location.hostname.toLowerCase();
  if (isMarketplaceApexHost(host)) {
    return window.location.origin;
  }
  if (isLocalDevHostname(host)) {
    const port = window.location.port ? `:${window.location.port}` : "";
    return `${window.location.protocol}//localhost${port}`;
  }
  const apex =
    resolveActiveVendorSubdomainBase(host) ||
    resolveVendorSubdomainApexFromHost(host);
  return apex ? `https://${apex.replace(/^www\./, "")}` : window.location.origin;
}

/** Full URL for summary after PWA pay — always unified return host (`walwal.online/summary`). */
export function buildPwaSummaryAbsoluteUrl(params: {
  storefrontOrigin?: string | null;
  summaryPath?: string | null;
  originPath?: string | null;
  merchantOrderId?: string;
  prepayId?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.merchantOrderId) qs.set("merch_order_id", params.merchantOrderId);
  if (params.prepayId) qs.set("prepay_id", params.prepayId);
  const q = qs.toString();

  void params.storefrontOrigin;
  void params.summaryPath;
  void params.originPath;

  const path = "/summary";
  const origin = unifiedKpayReturnOrigin();
  return q ? `${origin}${path}?${q}` : `${origin}${path}`;
}

export function clearKPayPwaPendingStorage(): void {
  try {
    localStorage.removeItem(KPAY_PWA_PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type StartKPayPwaParams = KPayBaseParams & {
  amount: number;
  merchantOrderId?: string;
  currency?: string;
  /** Offering name shown to the user in the KBZPay app (PWA `biz_content.title`). */
  title?: string;
  notifyUrl?: string;
  /** Optional URL-encoded business hint that KBZ echoes back in the webhook. */
  callbackInfo?: string;
  /** Checkout path before KBZ redirect — used to build summary URL on return. */
  originPath?: string;
  /** Order summary route, e.g. `/summary` or `/vendor/go-go/summary`. */
  summaryPath?: string;
  /** Where checkout started, e.g. `https://gogo.walwal.online`. */
  storefrontOrigin?: string;
  /** Full cart + shipping payload — stored server-side for post-payment order create. */
  draftOrder?: Record<string, unknown>;
};

export type PwaCheckoutDraftResponse = {
  merchantOrderId?: string;
  prepayId?: string;
  originPath?: string;
  summaryPath?: string;
  storefrontOrigin?: string;
  draftOrder?: Record<string, unknown>;
};

export type KPayPwaSession = {
  merchantOrderId: string;
  prepayId: string;
  /** Absolute KBZ PWA URL the customer's mobile browser must visit. */
  redirectUrl: string;
  pwaBase: string;
  isUat: boolean;
  endpointUsed?: string;
  debug?: {
    signSource?: string;
    sign?: string;
    signedPayload?: Record<string, unknown>;
    orderInfoSignSource?: string;
    orderInfoSign?: string;
    providerTopLevelKeys?: string[];
    providerNestedKeys?: string[];
  };
};

/**
 * Calls our backend to:
 *   1. precreate the order against KBZ with `trade_type=PWAAPP`
 *   2. build the SHA256 PWA orderinfo signature
 *   3. return a ready-to-redirect URL pointing at KBZ's PWA page
 *
 * The caller is responsible for performing the actual `window.location` redirect on
 * a mobile browser. The returned URL only works on a phone with KBZPay installed.
 */
export async function startKPayPwa(params: StartKPayPwaParams): Promise<KPayPwaSession> {
  const {
    projectId: _projectId,
    publicAnonKey: _publicAnonKey,
    amount,
    merchantOrderId = buildMerchantOrderId(),
    currency = "MMK",
    title,
    notifyUrl,
    callbackInfo,
    originPath,
    summaryPath,
    storefrontOrigin,
    draftOrder,
  } = params;

  const response = await fetch(
    `${API_ROOT}/kpay/pwa/start`,
    {
      method: "POST",
      headers: {
        ...cloudbaseHeaders({ "Content-Type": "application/json" }),
      },
      body: JSON.stringify({
        merchantOrderId,
        amount,
        currency,
        title,
        notifyUrl,
        callbackInfo,
        originPath,
        summaryPath,
        storefrontOrigin,
        draftOrder,
      }),
    },
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || !data?.success) {
    const kbz = data?.kbz as { code?: string; msg?: string; result?: string } | undefined;
    const kbzLine =
      kbz?.msg && kbz?.code
        ? `${kbz.code}: ${kbz.msg}`
        : (kbz?.msg || kbz?.code || (kbz?.result && kbz.result !== "SUCCESS" ? kbz.result : ""));
    const networkErr = typeof data?.networkError === "string" ? data.networkError : "";
    const hint = typeof data?.message === "string" ? data.message : "";
    const errTag = typeof data?.error === "string" ? data.error : "";
    const core =
      kbzLine ||
      hint ||
      networkErr ||
      errTag ||
      "Failed to start KBZPay PWA";
    throw new Error(core);
  }
  return {
    merchantOrderId: String(data.merchantOrderId || merchantOrderId),
    prepayId: String(data.prepayId || ""),
    redirectUrl: String(data.redirectUrl || ""),
    pwaBase: String(data.pwaBase || ""),
    isUat: Boolean(data.isUat),
    endpointUsed: typeof data.endpointUsed === "string" ? data.endpointUsed : undefined,
    debug: data.debug as KPayPwaSession["debug"],
  };
}

export async function fetchPwaCheckoutDraft(
  params: KPayBaseParams & { merchantOrderId: string }
): Promise<PwaCheckoutDraftResponse | null> {
  const { projectId: _projectId, publicAnonKey: _publicAnonKey, merchantOrderId } = params;
  const response = await fetch(
    `${API_ROOT}/kpay/pwa/draft/${encodeURIComponent(merchantOrderId)}`,
    { headers: cloudbaseHeaders() }
  );
  if (!response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { draft?: PwaCheckoutDraftResponse };
  return data.draft ?? null;
}

function parseFinalizeApiPayload(data: Record<string, unknown>): {
  ok: boolean;
  created?: boolean;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
} {
  return {
    ok: Boolean(data.success),
    created: Boolean(data.created),
    order:
      data.order && typeof data.order === "object"
        ? (data.order as Record<string, unknown>)
        : undefined,
    error: typeof data.error === "string" ? data.error : undefined,
    message: typeof data.message === "string" ? data.message : undefined,
  };
}

async function requestPwaFinalize(
  merchantOrderId: string,
  adminRecover: boolean,
): Promise<{ response: Response; data: Record<string, unknown> }> {
  const finalizeUrl = `${API_ROOT}/kpay/pwa/finalize/${encodeURIComponent(merchantOrderId)}`;
  const url = adminRecover ? `${finalizeUrl}?adminRecover=1` : finalizeUrl;
  const response = await fetch(url, {
    method: "POST",
    headers: cloudbaseHeaders(
      adminRecover
        ? { "x-admin-recover": "1", "Content-Type": "application/json" }
        : undefined,
    ),
    body: adminRecover
      ? JSON.stringify({ adminRecover: true, mode: "admin_recover" })
      : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, data };
}

function looksLikeBadRecoveryCustomerName(value: string): boolean {
  const v = value.trim();
  if (!v || v.length < 2) return true;
  if (v.startsWith("/")) return true;
  if (/^https?:\/\//i.test(v)) return true;
  return false;
}

function resolveRecoveryCustomerName(
  draftName: unknown,
  shipFullName: unknown,
  email: unknown,
): string {
  const candidates = [
    String(shipFullName ?? "").trim(),
    String(draftName ?? "").trim(),
    String(email ?? "").split("@")[0]?.trim() || "",
    "KBZPay Guest",
  ];
  for (const c of candidates) {
    if (!looksLikeBadRecoveryCustomerName(c)) return c;
  }
  return "KBZPay Guest";
}

async function recoverPwaDraftViaDirectOrderCreate(
  params: KPayBaseParams & { merchantOrderId: string },
): Promise<{
  ok: boolean;
  created?: boolean;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  const draft = await fetchPwaCheckoutDraft(params);
  const draftOrder = draft?.draftOrder;
  if (!draftOrder || typeof draftOrder !== "object") {
    return { ok: false, error: "no_checkout_draft" };
  }

  const d = draftOrder as Record<string, unknown>;
  const ship =
    d.shippingInfo && typeof d.shippingInfo === "object"
      ? (d.shippingInfo as Record<string, unknown>)
      : {};

  const customerName = resolveRecoveryCustomerName(d.customerName, ship.fullName, d.email);

  const orderPayload: Record<string, unknown> = {
    orderNumber: params.merchantOrderId,
    userId: d.userId ?? null,
    customer: customerName,
    customerName,
    email: d.email || "",
    phone: d.phone || ship.phone || "",
    status: "pending",
    paymentStatus: "paid",
    paymentMethod: "KBZPay (PWA)",
    total: Number(d.total || 0),
    subtotal: Number(d.subtotal || 0),
    discount: Number(d.discount || 0),
    vendor: d.vendor || "",
    vendorId: d.vendorId || undefined,
    couponCode: d.couponCode || null,
    couponId: d.couponId || null,
    items: Array.isArray(d.items) ? d.items : [],
    address: ship.address || "",
    city: ship.city || "",
    state: ship.state || "",
    zipCode: ship.zipCode || "",
    country: ship.country || "",
    notes: d.notes || "",
    kpay: {
      method: "pwa",
      merchantOrderId: params.merchantOrderId,
      prepayId: draft.prepayId || "",
      status: "paid",
      adminRecovered: true,
    },
  };

  const { ordersApi } = await import("../../utils/api");
  try {
    const res = (await ordersApi.create(orderPayload as never)) as Record<string, unknown>;
    const order =
      res.order && typeof res.order === "object"
        ? (res.order as Record<string, unknown>)
        : res.data && typeof res.data === "object"
          ? (res.data as Record<string, unknown>)
          : undefined;
    if (order) {
      return { ok: true, created: true, order };
    }
    return {
      ok: false,
      error: typeof res.error === "string" ? res.error : "create_failed",
      message: typeof res.message === "string" ? res.message : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: "create_failed",
      message: error instanceof Error ? error.message : "Failed to create order",
    };
  }
}

export async function finalizePwaCheckoutOrderApi(
  params: KPayBaseParams & { merchantOrderId: string; adminRecover?: boolean }
): Promise<{
  ok: boolean;
  created?: boolean;
  order?: Record<string, unknown>;
  error?: string;
  message?: string;
}> {
  const { merchantOrderId, adminRecover } = params;

  if (!adminRecover) {
    const { data } = await requestPwaFinalize(merchantOrderId, false);
    return parseFinalizeApiPayload(data);
  }

  const { response, data } = await requestPwaFinalize(merchantOrderId, true);
  const parsed = parseFinalizeApiPayload(data);
  if (parsed.ok && parsed.order) return parsed;

  const shouldFallback =
    response.status === 404 || parsed.error === "cloudbase_env_missing";

  if (shouldFallback) {
    const statusRes = await fetch(
      `${API_ROOT}/kpay/pwa/draft-status/${encodeURIComponent(merchantOrderId)}`,
      { headers: cloudbaseHeaders() },
    );
    const statusData = (await statusRes.json().catch(() => ({}))) as {
      canRecover?: boolean;
      txnStatus?: string | null;
    };
    if (!statusData.canRecover) {
      return {
        ok: false,
        error: "payment_not_confirmed",
        message: statusData.txnStatus || "Payment not confirmed in KBZPay",
      };
    }

    const direct = await recoverPwaDraftViaDirectOrderCreate(params);
    if (direct.ok) {
      await requestPwaFinalize(merchantOrderId, true).catch(() => {});
      return direct;
    }
    return {
      ok: false,
      error: direct.error || parsed.error || "recovery_failed",
      message: direct.message || parsed.message,
    };
  }

  return parsed;
}

export type OrphanedPwaDraftRow = {
  merchantOrderId: string;
  savedAt: string;
  prepayId?: string;
  vendor?: string;
  vendorId?: string;
  total?: number;
  txnStatus?: string;
  hasOrder: boolean;
  canRecover: boolean;
};

const ORPHANED_PWA_DRAFTS_CACHE_MS = 60_000;
const orphanedPwaDraftsCache = new Map<
  string,
  { at: number; rows: OrphanedPwaDraftRow[] }
>();

function orphanedPwaDraftsCacheKey(params?: {
  vendorId?: string;
  minAgeMinutes?: number;
  limit?: number;
  merchantOrderId?: string;
}): string {
  return [
    params?.vendorId?.trim() || "",
    params?.minAgeMinutes ?? "",
    params?.limit ?? "",
    params?.merchantOrderId?.trim() || "",
  ].join("|");
}

export function invalidateOrphanedPwaDraftsCache(): void {
  orphanedPwaDraftsCache.clear();
}

export async function fetchOrphanedPwaDrafts(params?: {
  vendorId?: string;
  minAgeMinutes?: number;
  limit?: number;
  merchantOrderId?: string;
}): Promise<OrphanedPwaDraftRow[]> {
  const cacheKey = orphanedPwaDraftsCacheKey(params);
  const cached = orphanedPwaDraftsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ORPHANED_PWA_DRAFTS_CACHE_MS) {
    return cached.rows;
  }

  const qs = new URLSearchParams();
  if (params?.vendorId?.trim()) qs.set("vendorId", params.vendorId.trim());
  if (params?.minAgeMinutes != null) qs.set("minAgeMinutes", String(params.minAgeMinutes));
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.merchantOrderId?.trim()) qs.set("merchantOrderId", params.merchantOrderId.trim());
  const query = qs.toString();
  const response = await fetch(
    `${API_ROOT}/kpay/pwa/orphaned-drafts${query ? `?${query}` : ""}`,
    { headers: cloudbaseHeaders() },
  );
  const data = (await response.json().catch(() => ({}))) as {
    drafts?: OrphanedPwaDraftRow[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Failed to load orphaned KBZPay drafts");
  }
  const rows = Array.isArray(data.drafts) ? data.drafts : [];
  orphanedPwaDraftsCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}
