import {
  UNIFIED_KPAY_SUMMARY_PATH,
  buildUnifiedKpaySummaryRedirectUrl,
  enrichKpayReturnSearch,
  isBareUnifiedKpayApexHost,
  isKpayCustomerReturnPath,
  isUnifiedKpayReturnHost,
  readKpayReturnPrepayId,
  readKpayReturnQueryOrderId,
  resolveKpaySummaryPublicOrigin,
} from "./vendorCheckoutPaths";

function normalizePathname(pathname: string): string {
  return (pathname.split("?")[0] || "").replace(/\/+$/, "") || "/";
}

function markKpayRedirectShell(): void {
  try {
    document.documentElement.classList.add("kpay-unified-redirect");
  } catch {
    /* ignore */
  }
}

/** Remove anti-flash shell so unified `/summary` is never stuck invisible. */
export function clearKpayRedirectShell(): void {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.classList.remove("kpay-unified-redirect");
  } catch {
    /* ignore */
  }
}

/** Merge pending PWA ids into the URL bar without navigation (no flash). */
function enrichUnifiedSummarySearchInPlace(): void {
  if (!isUnifiedKpayReturnHost()) return;
  if (normalizePathname(window.location.pathname) !== UNIFIED_KPAY_SUMMARY_PATH) return;

  const enriched = enrichKpayReturnSearch(window.location.search);
  const current = window.location.search || "";
  if (enriched === current) return;

  window.history.replaceState(null, "", `${UNIFIED_KPAY_SUMMARY_PATH}${enriched}`);
}

/**
 * EdgeOne may 405 on bare apex (`nexa-mm.com/summary`). KBZ often lands there when the
 * merchant portal registers the apex URL without `www.` — hard-redirect to www apex.
 *
 * @returns true when navigation to www started (do not mount React yet).
 */
function promoteBareUnifiedApexKpayToWww(): boolean {
  if (typeof window === "undefined") return false;
  if (!isBareUnifiedKpayApexHost()) return false;

  const path = normalizePathname(window.location.pathname);
  const search = window.location.search || "";
  const hasKpayQuery =
    Boolean(readKpayReturnQueryOrderId(search)) ||
    Boolean(readKpayReturnPrepayId(search)) ||
    /(?:^|[?&])callback_info=/i.test(search);

  let pendingKpay = false;
  try {
    pendingKpay = Boolean(localStorage.getItem("kpay_pwa_pending_order"));
  } catch {
    /* ignore */
  }

  const isKpayLanding =
    path === UNIFIED_KPAY_SUMMARY_PATH ||
    isKpayCustomerReturnPath(path) ||
    (path === "/" && (hasKpayQuery || pendingKpay)) ||
    (path === UNIFIED_KPAY_SUMMARY_PATH && pendingKpay);

  if (!isKpayLanding) return false;

  const enriched = enrichKpayReturnSearch(search);
  const target = `${resolveKpaySummaryPublicOrigin()}${UNIFIED_KPAY_SUMMARY_PATH}${enriched}`;
  const here = window.location.href.split("#")[0];
  if (here === target) return false;

  markKpayRedirectShell();
  window.location.replace(target);
  return true;
}

/** `/kpay/return` or `/kpay/pwa/return` on unified apex → `/summary`. */
function promoteKpayReturnPathInPlace(): void {
  if (!isUnifiedKpayReturnHost()) return;
  if (!isKpayCustomerReturnPath(window.location.pathname)) return;

  const enriched = enrichKpayReturnSearch(window.location.search);
  window.history.replaceState(null, "", `${UNIFIED_KPAY_SUMMARY_PATH}${enriched}`);
}

/**
 * Normalize KPay return URL before React paints.
 * Same-origin fixes use `replaceState` (no visible reload).
 * Vendor subdomain → apex uses one hard `location.replace`.
 *
 * @returns true when a cross-origin redirect started (do not mount React yet).
 */
export function maybeRedirectKpayReturnToUnifiedSummary(): boolean {
  if (typeof window === "undefined") return false;

  if (promoteBareUnifiedApexKpayToWww()) return true;

  promoteKpayReturnPathInPlace();
  enrichUnifiedSummarySearchInPlace();

  const path = normalizePathname(window.location.pathname);
  if (path === UNIFIED_KPAY_SUMMARY_PATH && isUnifiedKpayReturnHost()) {
    clearKpayRedirectShell();
    return false;
  }

  if (isUnifiedKpayReturnHost()) {
    return false;
  }

  const target = buildUnifiedKpaySummaryRedirectUrl();
  if (!target) return false;

  const here = window.location.href.split("#")[0];
  if (here === target) return false;

  markKpayRedirectShell();
  window.location.replace(target);
  return true;
}
