/** Shared path heuristics for vendor customer storefront (Suspense fallbacks, prefetch). */

const MARKETPLACE_VENDOR_NON_STOREFRONT = new Set(["application", "setup", "login"]);

export function normalizeStorefrontPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function isMarketplaceVendorStorefrontPath(pathname: string): boolean {
  const p = normalizeStorefrontPath(pathname);

  const slashVendor = p.match(/^\/vendor\/([^/]+)(?:\/(.*))?$/);
  if (slashVendor) {
    const segment = slashVendor[1].toLowerCase();
    if (MARKETPLACE_VENDOR_NON_STOREFRONT.has(segment)) return false;
    if (/^\/vendor\/[^/]+\/admin(\/|$)/.test(p)) return false;
    return true;
  }

  return /^\/vendor-[^/]+(\/|$)/.test(p);
}

export function isVendorStorefrontProductPath(pathname: string): boolean {
  const p = normalizeStorefrontPath(pathname);
  if (/^\/product\/[^/]+/.test(p)) return true;
  if (/^\/vendor\/[^/]+\/product\/[^/]+/.test(p)) return true;
  if (/^\/vendor-[^/]+\/product\/[^/]+/.test(p)) return true;
  return false;
}

/** Product slug segment from a storefront PDP URL (host-root or marketplace). */
export function extractVendorStorefrontProductSlug(
  pathname: string,
  storeBase = "",
): string | undefined {
  const p = normalizeStorefrontPath(pathname);
  const base = normalizeStorefrontPath(storeBase);
  if (base && p.startsWith(`${base}/product/`)) {
    const seg = p.slice(`${base}/product/`.length).split("/")[0]?.trim();
    return seg || undefined;
  }
  const patterns = [
    /^\/vendor\/[^/]+\/product\/([^/]+)/,
    /^\/vendor-[^/]+\/product\/([^/]+)/,
    /^\/product\/([^/]+)/,
  ] as const;
  for (const pattern of patterns) {
    const m = p.match(pattern);
    const seg = m?.[1]?.trim();
    if (seg) return seg;
  }
  return undefined;
}

/** `/vendor-nexa/...` → `/vendor/nexa/...` (canonical marketplace paths). */
export function vendorDashPrefixPathToSlash(pathname: string): string | null {
  const raw = normalizeStorefrontPath(pathname);
  const m = raw.match(/^\/vendor-([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  const store = decodeURIComponent(m[1]);
  const tail = m[2]?.trim();
  return tail ? `/vendor/${encodeURIComponent(store)}/${tail}` : `/vendor/${encodeURIComponent(store)}`;
}

export function isVendorStorefrontSavedPath(pathname: string): boolean {
  const p = normalizeStorefrontPath(pathname);
  return p === "/saved" || /\/saved$/.test(p);
}
