import { SmartCache } from "../../utils/cache";
import { cacheManager } from "./cacheManager";
import { moduleCache } from "./module-cache";
import { freeLocalStorageForAuth, removePersistedKeysPrefix } from "./persistedLocalCache";

export const DEPLOY_VERSION_LS_KEY = "migoo-deploy-version";
const DEPLOY_RELOAD_GUARD_SS_KEY = "migoo-deploy-reload-guard";
const DEPLOY_WATCHER_STARTED_KEY = "__migooDeployWatcherStarted";

const SESSION_KEYS_TO_KEEP = new Set([
  "kpay_pwa_pending_order",
  "kpay_summary_storefront_origin",
]);

/** Drop catalog/admin caches but keep auth, cart user session, and in-flight payment state. */
export function purgeDeployClientCaches(): void {
  freeLocalStorageForAuth();
  removePersistedKeysPrefix("migoo-ls-");
  SmartCache.clearAll();
  moduleCache.clear();
  cacheManager.invalidateAll();

  if (typeof sessionStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key || SESSION_KEYS_TO_KEEP.has(key) || key.startsWith("nexa-cloudbase")) continue;
      keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function unregisterServiceWorkersAndCaches(): Promise<void> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

export function readStoredDeployVersion(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return String(localStorage.getItem(DEPLOY_VERSION_LS_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeStoredDeployVersion(buildId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DEPLOY_VERSION_LS_KEY, buildId);
  } catch {
    /* ignore */
  }
}

export function clearDeployReloadGuard(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(DEPLOY_RELOAD_GUARD_SS_KEY);
  } catch {
    /* ignore */
  }
}

export function hardReloadForDeploy(buildId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(DEPLOY_RELOAD_GUARD_SS_KEY, buildId);
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_dv", buildId);
  window.location.replace(url.toString());
}

export async function fetchRemoteDeployVersion(): Promise<string | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const response = await fetch(`/version.json?_=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { buildId?: unknown };
    const buildId = String(payload?.buildId || "").trim();
    return buildId || null;
  } catch {
    return null;
  }
}

/** Returns true when a reload was triggered. */
export async function applyDeployUpdateIfNeeded(nextBuildId: string): Promise<boolean> {
  const buildId = String(nextBuildId || "").trim();
  if (!buildId) return false;

  const previous = readStoredDeployVersion();
  if (!previous) {
    writeStoredDeployVersion(buildId);
    clearDeployReloadGuard();
    return false;
  }
  if (previous === buildId) {
    clearDeployReloadGuard();
    return false;
  }

  if (typeof sessionStorage !== "undefined") {
    try {
      if (sessionStorage.getItem(DEPLOY_RELOAD_GUARD_SS_KEY) === buildId) {
        writeStoredDeployVersion(buildId);
        clearDeployReloadGuard();
        return false;
      }
    } catch {
      /* ignore */
    }
  }

  purgeDeployClientCaches();
  await unregisterServiceWorkersAndCaches();
  writeStoredDeployVersion(buildId);
  hardReloadForDeploy(buildId);
  return true;
}

/** Compare bundled build id (dev/prod) after the app boots. */
export async function bootstrapDeployVersionFromBundle(): Promise<void> {
  const bundledBuildId = String(import.meta.env.VITE_BUILD_ID || "").trim();
  if (!bundledBuildId || bundledBuildId === "dev") return;
  await applyDeployUpdateIfNeeded(bundledBuildId);
}

let deployWatcherStarted = false;

/** Poll `/version.json` so open tabs refresh after a new EdgeOne deploy. */
export function startDeployVersionWatcher(): void {
  if (typeof window === "undefined") return;
  const scoped = window as typeof window & Record<string, unknown>;
  if (deployWatcherStarted || scoped[DEPLOY_WATCHER_STARTED_KEY]) return;
  deployWatcherStarted = true;
  scoped[DEPLOY_WATCHER_STARTED_KEY] = true;

  const check = () => {
    void fetchRemoteDeployVersion().then((remoteBuildId) => {
      if (!remoteBuildId) return;
      void applyDeployUpdateIfNeeded(remoteBuildId);
    });
  };

  window.setInterval(check, 2 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("focus", check);
}
