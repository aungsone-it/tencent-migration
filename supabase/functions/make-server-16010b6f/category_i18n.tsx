export type CategoryLocaleNames = {
  en?: string;
  my?: string;
};

const MYANMAR_SCRIPT = /[\u1000-\u109F]/;

export function hasMyanmarScript(text: string): boolean {
  return MYANMAR_SCRIPT.test(text);
}

async function translateText(text: string, langpair: "en|my" | "my|en"): Promise<string | null> {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed.slice(0, 500))}&langpair=${langpair}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const translated = String(payload?.responseData?.translatedText || "").trim();
    if (!translated) return null;
    if (translated.toUpperCase() === trimmed.toUpperCase()) return null;
    if (/^MYMEMORY WARNING:/i.test(translated)) return null;
    return translated;
  } catch {
    return null;
  }
}

export async function buildCategoryLocaleNames(name: string): Promise<CategoryLocaleNames> {
  const canonical = String(name || "").trim();
  if (!canonical) return {};

  if (hasMyanmarScript(canonical)) {
    const en = await translateText(canonical, "my|en");
    return {
      my: canonical,
      ...(en ? { en } : {}),
    };
  }

  const my = await translateText(canonical, "en|my");
  return {
    en: canonical,
    ...(my ? { my } : {}),
  };
}

export function resolveCategoryDisplayName(
  category: { name?: string; names?: CategoryLocaleNames },
  language: "en" | "my" | "zh" = "en"
): string {
  const fallback = String(category?.name || "").trim();
  const names = category?.names || {};
  if (language === "my") {
    return String(names.my || "").trim() || fallback;
  }
  return String(names.en || "").trim() || fallback;
}

export async function ensureCategoryLocaleNames<T extends { name?: string; names?: CategoryLocaleNames }>(
  category: T
): Promise<T> {
  const name = String(category?.name || "").trim();
  if (!name) return category;

  const existingMy = String(category?.names?.my || "").trim();
  const existingEn = String(category?.names?.en || "").trim();
  if (existingMy && existingEn) return category;

  const built = await buildCategoryLocaleNames(name);
  const names: CategoryLocaleNames = {
    en: existingEn || built.en || (hasMyanmarScript(name) ? "" : name),
    my: existingMy || built.my || "",
  };

  if (!names.en && !hasMyanmarScript(name)) names.en = name;
  if (!names.my && hasMyanmarScript(name)) names.my = name;

  if (existingMy === names.my && existingEn === names.en) return category;
  return { ...category, names };
}
