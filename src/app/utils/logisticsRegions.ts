/** English region keys for logistics coverage (matches checkout Myanmar regions). */
export const LOGISTICS_REGION_OPTIONS = [
  "Yangon",
  "Mandalay",
  "Naypyidaw",
  "Ayeyarwady",
  "Bago",
  "Chin",
  "Kachin",
  "Kayah",
  "Kayin",
  "Magway",
  "Mon",
  "Rakhine",
  "Sagaing",
  "Shan",
  "Tanintharyi",
] as const;

export type LogisticsRegion = (typeof LOGISTICS_REGION_OPTIONS)[number];

export type RegionShippingRate = {
  estimatedDays: string;
  costMin: string;
  costMax: string;
};

export function getPartnerRegionKeys(
  regionRates: Record<string, RegionShippingRate> | undefined | null
): string[] {
  if (!regionRates || typeof regionRates !== "object") return [];
  return Object.keys(regionRates).sort((a, b) => a.localeCompare(b));
}

export function parseCostNumber(value: string): number | null {
  const digits = String(value || "").replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function formatCostKyats(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  if (/ကျပ်|mmk/i.test(raw)) return raw;
  const n = parseCostNumber(raw);
  if (n == null) return raw;
  return `${n.toLocaleString()} ကျပ်`;
}

export function formatCostRangeKyats(costMin: string, costMax: string): string {
  const min = parseCostNumber(costMin);
  const max = parseCostNumber(String(costMax || "").trim());
  if (min == null && max == null) return "—";
  if (min != null && max != null && min !== max) {
    return `${min.toLocaleString()} – ${max.toLocaleString()} ကျပ်`;
  }
  const single = min ?? max;
  return single != null ? `${single.toLocaleString()} ကျပ်` : "—";
}
