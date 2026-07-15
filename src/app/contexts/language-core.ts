import { createContext } from "react";

export type Language = "en" | "zh" | "my";

export interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  setStorefrontLanguageOverride: (lang: Language | null) => void;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);
