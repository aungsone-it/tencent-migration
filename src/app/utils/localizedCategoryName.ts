import type { Language } from "../contexts/language-core";

export type CategoryLocaleNames = Partial<Record<"en" | "my", string>>;

export function localizedCategoryName(
  category: { name: string; names?: CategoryLocaleNames },
  language: Language
): string {
  const fallback = String(category.name || "").trim();
  const names = category.names || {};

  if (language === "my") {
    return String(names.my || "").trim() || fallback;
  }

  return String(names.en || "").trim() || fallback;
}
