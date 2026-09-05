const ADMIN_ORDERS_UPDATED_STORAGE_KEY = "migoo-admin-orders-updated-at";

/** Set when order data changed on the server (storefront checkout, admin mutations, cache invalidation). */
const SS_SUPER_ADMIN_FINANCES_STALE = "migoo-ss-super-admin-finances-stale-v1";

export type AdminOrdersUpdatedStoragePayload = {
  at: number;
  reason?: string;
};

export function adminOrdersUpdatedStorageKey(): string {
  return ADMIN_ORDERS_UPDATED_STORAGE_KEY;
}

export function readAdminOrdersUpdatedStorageEvent(
  raw: string | null | undefined,
): AdminOrdersUpdatedStoragePayload | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as AdminOrdersUpdatedStoragePayload;
    if (parsed && typeof parsed === "object" && typeof parsed.at === "number") {
      return parsed;
    }
  } catch {
    /* legacy numeric timestamp */
  }
  const at = Number(raw);
  return Number.isFinite(at) ? { at } : null;
}

/** Super-admin Finances must not trust LS/module snapshot until the next network revalidation. */
export function markSuperAdminFinancesSessionStale(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SS_SUPER_ADMIN_FINANCES_STALE, "1");
  } catch {
    /* ignore */
  }
}

export function isSuperAdminFinancesSessionStale(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(SS_SUPER_ADMIN_FINANCES_STALE) === "1";
  } catch {
    return false;
  }
}

/** Clears the flag and returns whether a forced finances refetch was needed. */
export function consumeSuperAdminFinancesSessionStale(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    if (sessionStorage.getItem(SS_SUPER_ADMIN_FINANCES_STALE) !== "1") return false;
    sessionStorage.removeItem(SS_SUPER_ADMIN_FINANCES_STALE);
    return true;
  } catch {
    return false;
  }
}

/** Merge rapid pulses before refetch so the table does not blink. */
export const ADMIN_ORDERS_REALTIME_DEBOUNCE_MS = 180;

/** Stagger refetches while SQL read model catches up after KV order writes. */
export const ADMIN_ORDERS_REALTIME_RETRY_MS = 2000;

export type AdminOrdersLoadOptions = { silent?: boolean };

/** Debounce rapid pulses and refetch in the background without UI blink. */
export function createAdminOrdersRealtimeRefetchScheduler(
  load: (forceRefresh: boolean, options?: AdminOrdersLoadOptions) => void | Promise<void>,
) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let queued = false;
  let retryWanted = false;
  let cancelled = false;

  const run = () => {
    if (cancelled) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    queued = false;
    void Promise.resolve(load(true, { silent: true })).finally(() => {
      if (cancelled) return;
      inFlight = false;
      if (queued) run();
    });
  };

  return {
    schedule(withRetry = false) {
      if (cancelled) return;
      if (withRetry) retryWanted = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const doRetry = retryWanted;
        retryWanted = false;
        run();
        if (retryTimer) clearTimeout(retryTimer);
        if (doRetry) {
          retryTimer = setTimeout(() => run(), ADMIN_ORDERS_REALTIME_RETRY_MS);
        }
      }, ADMIN_ORDERS_REALTIME_DEBOUNCE_MS);
    },
    cancel() {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      debounceTimer = null;
      retryTimer = null;
      queued = false;
      retryWanted = false;
    },
  };
}

/** @deprecated Prefer createAdminOrdersRealtimeRefetchScheduler for stable background refresh. */
export function scheduleAdminOrdersRealtimeRefetch(
  load: (forceRefresh: boolean, options?: AdminOrdersLoadOptions) => void | Promise<void>,
  withRetries = false,
): () => void {
  const scheduler = createAdminOrdersRealtimeRefetchScheduler(load);
  scheduler.schedule(withRetries);
  return () => scheduler.cancel();
}

export function shouldRetryAdminOrdersRealtime(reason: string | undefined): boolean {
  return (
    reason === "realtime-order-pulse" ||
    reason === "storefront-checkout-order-created" ||
    reason === "storefront-order-created" ||
    reason === "pwa-checkout-order-created" ||
    reason === "order-updated" ||
    reason === "vendor-admin-order-updated" ||
    reason === "vendor-withdrawal" ||
    reason === "invalidate-admin-orders-cache"
  );
}

/** Broadcast order mutations to this tab + other tabs (via storage event). */
export function notifyAdminOrdersUpdated(
  reason = "orders-mutated",
  extra?: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  if (
    reason === "storefront-order-created" ||
    reason === "storefront-checkout-order-created" ||
    reason === "pwa-checkout-order-created" ||
    reason === "invalidate-admin-orders-cache" ||
    reason === "realtime-order-pulse" ||
    reason === "remove-admin-orders" ||
    reason === "patch-admin-orders-status" ||
    reason === "order-updated" ||
    reason === "vendor-admin-order-updated" ||
    reason === "vendor-withdrawal" ||
    reason === "kpay-refund-payment-updated"
  ) {
    markSuperAdminFinancesSessionStale();
  }
  const at = Date.now();
  try {
    localStorage.setItem(
      ADMIN_ORDERS_UPDATED_STORAGE_KEY,
      JSON.stringify({ at, reason }),
    );
  } catch {
    // Best effort only.
  }
  window.dispatchEvent(
    new CustomEvent("adminOrdersUpdated", { detail: { at, reason, ...extra } })
  );
}
