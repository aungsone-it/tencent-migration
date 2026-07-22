/**
 * Tab-scoped catalog "load more" state — survives in-app navigation and regular refresh (F5).
 * Cleared when the tab closes, or on a best-effort bypass-cache reload (Shift+reload).
 */

import { devWarn } from "./devLog";

export type SessionCatalogListState = {
  products: unknown[];
  page: number;
  hasMore: boolean;
  total: number;
  savedAt?: number;
};

const SS_STOREFRONT_CATALOG_PREFIX = "migoo-ss-storefront-catalog-";
const SS_VENDOR_CATALOG_PREFIX = "migoo-ss-vendor-catalog-";
const SS_VENDOR_SCROLL_PREFIX = "migoo-ss-vendor-scroll-";

export function ssStorefrontCatalogListKey(catalogKey: string): string {
  return `${SS_STOREFRONT_CATALOG_PREFIX}${encodeURIComponent(catalogKey)}-v1`;
}

export function ssVendorCatalogListKey(sliceKey: string): string {
  return `${SS_VENDOR_CATALOG_PREFIX}${encodeURIComponent(sliceKey)}-v1`;
}

export function ssVendorScrollPositionKey(sliceKey: string): string {
  return `${SS_VENDOR_SCROLL_PREFIX}${encodeURIComponent(sliceKey)}-v1`;
}

export type SessionScrollPositionState = {
  scrollTop: number;
  anchorProductId?: string;
};

export function readSessionScrollPosition(key: string): SessionScrollPositionState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw) as SessionScrollPositionState;
      if (parsed && typeof parsed.scrollTop === "number" && parsed.scrollTop >= 0) {
        return parsed;
      }
    } catch {
      /* legacy plain number */
    }
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? { scrollTop: n } : null;
  } catch {
    return null;
  }
}

export function writeSessionScrollPosition(key: string, state: SessionScrollPositionState): void {
  if (typeof sessionStorage === "undefined") return;
  if (!Number.isFinite(state.scrollTop) || state.scrollTop < 0) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        scrollTop: Math.round(state.scrollTop),
        ...(state.anchorProductId ? { anchorProductId: state.anchorProductId } : {}),
      }),
    );
  } catch (e) {
    devWarn("[persistedSessionCache] scroll write failed (quota?)", key, e);
  }
}

export function readSessionCatalogList(key: string): SessionCatalogListState | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCatalogListState;
    if (!parsed || !Array.isArray(parsed.products) || parsed.products.length === 0) {
      return null;
    }
    if (typeof parsed.page !== "number" || typeof parsed.total !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSessionCatalogList(
  key: string,
  state: SessionCatalogListState
): void {
  if (typeof sessionStorage === "undefined") return;
  if (!state.products.length) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        products: state.products,
        page: state.page,
        hasMore: state.hasMore,
        total: state.total,
        savedAt: Date.now(),
      })
    );
  } catch (e) {
    devWarn("[persistedSessionCache] write failed (quota?)", key, e);
  }
}

export function removeSessionCatalogList(key: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearSessionCatalogListsByPrefix(prefix: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Best-effort: bypass-cache reloads should start a fresh browse grid. */
export function isLikelyHardPageReload(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | (PerformanceNavigationTiming & { deliveryType?: string })
      | undefined;
    if (!nav || nav.type !== "reload") return false;
    if (nav.deliveryType === "network") return true;
    if (nav.deliveryType === "cache") return false;
    return false;
  } catch {
    return false;
  }
}

export function initSessionCatalogPersistence(): void {
  if (typeof window === "undefined") return;
  if (!isLikelyHardPageReload()) return;
  clearSessionCatalogListsByPrefix(SS_STOREFRONT_CATALOG_PREFIX);
  clearSessionCatalogListsByPrefix(SS_VENDOR_CATALOG_PREFIX);
  clearSessionCatalogListsByPrefix(SS_VENDOR_SCROLL_PREFIX);
}

initSessionCatalogPersistence();
