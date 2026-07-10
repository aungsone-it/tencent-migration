import { readPersistedJson, writePersistedJson } from "./persistedLocalCache";

const MYANMAR_SCRIPT = /[\u1000-\u109F]/;
const TRANSLATION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const memoryCache = new Map<string, string>();

export function hasMyanmarScript(text: string): boolean {
  return MYANMAR_SCRIPT.test(text);
}

function translationCacheKey(name: string): string {
  return `migoo-ls-cat-tr-${encodeURIComponent(name.trim().toLowerCase())}-v1`;
}

export function vendorCategoryNeedsLocaleMy(category: { name?: string; names?: { my?: string } }): boolean {
  const name = String(category?.name || "").trim();
  if (!name) return false;
  if (hasMyanmarScript(name)) return false;
  return !String(category?.names?.my || "").trim();
}

export function vendorCategoriesNeedLocaleMy(categories: unknown[]): boolean {
  return Array.isArray(categories) && categories.some((category) => vendorCategoryNeedsLocaleMy(category as any));
}

export async function translateCategoryNameEnToMy(name: string): Promise<string | null> {
  const trimmed = String(name || "").trim();
  if (!trimmed || hasMyanmarScript(trimmed)) return null;

  const cacheKey = trimmed.toLowerCase();
  const cachedMemory = memoryCache.get(cacheKey);
  if (cachedMemory) return cachedMemory;

  const lsKey = translationCacheKey(trimmed);
  const cachedLs = readPersistedJson<string>(lsKey, TRANSLATION_TTL_MS);
  if (typeof cachedLs === "string" && cachedLs.trim()) {
    memoryCache.set(cacheKey, cachedLs.trim());
    return cachedLs.trim();
  }

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed.slice(0, 500))}&langpair=en|my`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const translated = String(payload?.responseData?.translatedText || "").trim();
    if (!translated || /^MYMEMORY WARNING:/i.test(translated)) return null;
    if (translated.toUpperCase() === trimmed.toUpperCase()) return null;

    memoryCache.set(cacheKey, translated);
    writePersistedJson(lsKey, translated);
    return translated;
  } catch {
    return null;
  }
}

export async function enrichVendorCategoriesWithLocaleNames<T extends { name?: string; names?: { en?: string; my?: string } }>(
  categories: T[]
): Promise<T[]> {
  if (!Array.isArray(categories) || categories.length === 0) return categories;

  return Promise.all(
    categories.map(async (category) => {
      const name = String(category?.name || "").trim();
      if (!name) return category;

      const existingMy = String(category?.names?.my || "").trim();
      if (existingMy) return category;

      if (hasMyanmarScript(name)) {
        return {
          ...category,
          names: {
            en: String(category?.names?.en || "").trim() || undefined,
            my: name,
          },
        };
      }

      const my = await translateCategoryNameEnToMy(name);
      if (!my) return category;

      return {
        ...category,
        names: {
          en: name,
          my,
        },
      };
    })
  );
}
