// Language Context - non-English bundles loaded on demand to shrink initial bundle
import { useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import { useLocation } from "react-router";
import { Language, LanguageContext } from "./language-core";
import { enTranslations } from "./translations/en";
import {
  isAdminLanguageScope,
  readStoredLanguage,
  resolveLanguageScope,
  writeStoredLanguage,
} from "../utils/languageScope";

type TranslationMap = Record<string, string>;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const languageScope = resolveLanguageScope(location.pathname);
  const [language, setLanguageState] = useState<Language>(() =>
    readStoredLanguage(languageScope)
  );
  const [storefrontLanguageOverride, setStorefrontLanguageOverrideState] =
    useState<Language | null>(null);
  const [zhMap, setZhMap] = useState<TranslationMap | null>(null);
  const [myMap, setMyMap] = useState<TranslationMap | null>(null);

  const effectiveLanguage: Language =
    storefrontLanguageOverride ??
    (isAdminLanguageScope(languageScope) && language === "my" ? "en" : language);

  // When switching between storefront / super admin / vendor admin, load that portal's saved language.
  useEffect(() => {
    setLanguageState(readStoredLanguage(languageScope));
  }, [languageScope]);

  useEffect(() => {
    if (storefrontLanguageOverride) return;
    writeStoredLanguage(languageScope, language);
  }, [language, languageScope, storefrontLanguageOverride]);

  useEffect(() => {
    if (effectiveLanguage !== "zh" || zhMap) return;
    let cancelled = false;
    void import("./translations/zh").then((mod) => {
      if (!cancelled) setZhMap(mod.zhTranslations as TranslationMap);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveLanguage, zhMap]);

  useEffect(() => {
    if (effectiveLanguage !== "my" || myMap) return;
    let cancelled = false;
    void import("./translations/my").then((mod) => {
      if (!cancelled) setMyMap(mod.myTranslations as TranslationMap);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveLanguage, myMap]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  const setStorefrontLanguageOverride = useCallback((lang: Language | null) => {
    setStorefrontLanguageOverrideState(lang);
  }, []);

  const t = useCallback(
    (key: string): string => {
      if (effectiveLanguage === "zh" && zhMap) {
        return zhMap[key] ?? enTranslations[key] ?? key;
      }
      if (effectiveLanguage === "my" && myMap) {
        return myMap[key] ?? enTranslations[key] ?? key;
      }
      return enTranslations[key] ?? key;
    },
    [effectiveLanguage, zhMap, myMap]
  );

  const value = useMemo(
    () => ({
      language: effectiveLanguage,
      setLanguage,
      t,
      setStorefrontLanguageOverride,
    }),
    [effectiveLanguage, setLanguage, t, setStorefrontLanguageOverride]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export { useLanguage } from "./useLanguage";
