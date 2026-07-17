import type { Language } from "../contexts/language-core";
import {
  MYANMAR_REGION_LABELS_MY,
  MYANMAR_TOWNSHIP_LABELS_MY,
} from "./myanmarRegionLabelsMy";
import { getMyanmarTownshipSearchTerms as buildTownshipSearchTerms } from "./myanmarRegions";

export function getMyanmarRegionLabel(region: string, language: Language): string {
  if (language !== "my") return region;
  return (
    MYANMAR_REGION_LABELS_MY[region as keyof typeof MYANMAR_REGION_LABELS_MY] ?? region
  );
}

export function getMyanmarTownshipLabel(township: string, language: Language): string {
  if (language !== "my") return township;
  return (
    MYANMAR_TOWNSHIP_LABELS_MY[township as keyof typeof MYANMAR_TOWNSHIP_LABELS_MY] ??
    township
  );
}

export function getMyanmarTownshipSearchTerms(township: string, language: Language): string {
  return buildTownshipSearchTerms(township, language === "my" ? "my" : "en");
}

export function formatMyanmarLocationLine(
  city: string | undefined,
  state: string | undefined,
  language: Language
): string {
  const cityTrimmed = String(city || "").trim();
  const stateTrimmed = String(state || "").trim();
  const cityLabel = cityTrimmed ? getMyanmarTownshipLabel(cityTrimmed, language) : "";
  const stateLabel = stateTrimmed ? getMyanmarRegionLabel(stateTrimmed, language) : "";
  if (cityLabel && stateLabel) return `${cityLabel}, ${stateLabel}`;
  return cityLabel || stateLabel;
}
