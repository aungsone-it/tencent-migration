import type { DeliveryPartner } from "../../utils/api";
import { parseCostNumber, resolveEffectiveRegionRate } from "./logisticsRegions";
import { normalizePartnerStatus } from "./logisticsPartnerForm";
import { normalizeTownshipKey } from "./myanmarRegions";

export type CheckoutLogisticsQuote = {
  partner: DeliveryPartner;
  regionKey: string;
  townshipKey?: string;
  estimatedDays: string;
  shippingFee: number;
  costMin: number;
  costMax: number | null;
  codSupported: boolean;
  isTownshipException: boolean;
};

export function resolveCheckoutLogisticsQuote(
  partners: DeliveryPartner[],
  regionKey: string | undefined | null,
  townshipKey?: string | undefined | null
): CheckoutLogisticsQuote | null {
  const region = String(regionKey || "").trim();
  if (!region) return null;

  const township = normalizeTownshipKey(region, townshipKey) || String(townshipKey || "").trim() || undefined;

  const candidates: CheckoutLogisticsQuote[] = [];
  for (const partner of partners) {
    if (normalizePartnerStatus(partner.status) !== "active") continue;
    const baseRate = partner.regionRates?.[region];
    if (!baseRate) continue;

    const rate = resolveEffectiveRegionRate(baseRate, township);

    const costMin = parseCostNumber(rate.costMin);
    if (costMin == null) continue;

    const costMaxRaw = parseCostNumber(rate.costMax);
    candidates.push({
      partner,
      regionKey: region,
      townshipKey: rate.isTownshipException ? rate.townshipKey : township,
      estimatedDays: rate.estimatedDays,
      shippingFee: costMin,
      costMin,
      costMax:
        costMaxRaw != null && costMaxRaw !== costMin ? costMaxRaw : null,
      codSupported: partner.codSupported,
      isTownshipException: rate.isTownshipException,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.shippingFee - b.shippingFee);
  return candidates[0];
}

export function formatCheckoutShippingLabel(
  quote: CheckoutLogisticsQuote | null,
  formatPrice: (amount: number) => string
): string | null {
  if (!quote) return null;
  if (quote.costMax != null) {
    return `${formatPrice(quote.costMin)} – ${formatPrice(quote.costMax)}`;
  }
  return formatPrice(quote.shippingFee);
}

/** Extract the upper bound from admin duration strings like "2-3 days" or "3 to 10 days". */
export function parseEstimatedDeliveryMaxDays(value: string): number | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const numbers = trimmed
    .match(/\d+/g)
    ?.map((part) => Number(part))
    .filter((n) => Number.isFinite(n));
  if (!numbers?.length) return null;
  return Math.max(...numbers);
}

export function formatEstimatedDeliveryLabel(
  value: string,
  formatWithinDays: (days: number) => string
): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const maxDays = parseEstimatedDeliveryMaxDays(trimmed);
  if (maxDays == null) return trimmed;
  return formatWithinDays(maxDays);
}
