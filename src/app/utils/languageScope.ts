import type { Language } from "../contexts/language-core";
import { pathnameUnderAdmin, resolveVendorSubdomainStoreSlug } from "./vendorSubdomainHooks";

export type LanguageScope = "storefront" | "super-admin" | "vendor-admin";

const STORAGE_KEYS: Record<LanguageScope, string> = {
  storefront: "migoo-language",
  "super-admin": "migoo-language-super-admin",
  "vendor-admin": "migoo-language-vendor-admin",
};

const VALID_LANGUAGES = new Set<Language>(["en", "zh", "my"]);

export function resolveLanguageScope(pathname: string): LanguageScope {
  if (/\/(store|vendor)\/[^/]+\/admin(?:\/|$)/.test(pathname)) {
    return "vendor-admin";
  }
  if (pathnameUnderAdmin(pathname)) {
    if (typeof window !== "undefined" && resolveVendorSubdomainStoreSlug()) {
      return "vendor-admin";
    }
    return "super-admin";
  }
  return "storefront";
}

function parseStoredLanguage(raw: string | null): Language | null {
  if (raw === "en" || raw === "zh" || raw === "my") return raw;
  return null;
}

/** Read persisted language for a portal scope (client-only). */
export function readStoredLanguage(scope: LanguageScope): Language {
  if (typeof window === "undefined") return "en";
  try {
    const scoped = parseStoredLanguage(localStorage.getItem(STORAGE_KEYS[scope]));
    if (scoped) return scoped;

    // One-time legacy migration: old single key applied to super admin only.
    if (scope === "super-admin") {
      const legacy = parseStoredLanguage(localStorage.getItem(STORAGE_KEYS.storefront));
      if (legacy) return legacy;
    }
  } catch {
    /* ignore */
  }
  return "en";
}

/** Persist language for the active portal scope (client-only). */
export function writeStoredLanguage(scope: LanguageScope, language: Language): void {
  if (typeof window === "undefined" || !VALID_LANGUAGES.has(language)) return;
  try {
    localStorage.setItem(STORAGE_KEYS[scope], language);
  } catch {
    /* ignore */
  }
}

export function isAdminLanguageScope(scope: LanguageScope): boolean {
  return scope === "super-admin" || scope === "vendor-admin";
}
