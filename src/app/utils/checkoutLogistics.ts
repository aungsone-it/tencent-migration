import type { DeliveryPartner } from "../../utils/api";
import { parseCostNumber } from "./logisticsRegions";

export type CheckoutLogisticsQuote = {
  partner: DeliveryPartner;
  regionKey: string;
  estimatedDays: string;
  shippingFee: number;
  costMin: number;
  costMax: number | null;
  codSupported: boolean;
  codFee: number;
};

export function resolveCheckoutLogisticsQuote(
  partners: DeliveryPartner[],
  regionKey: string | undefined | null
): CheckoutLogisticsQuote | null {
  const region = String(regionKey || "").trim();
  if (!region) return null;

  const candidates: CheckoutLogisticsQuote[] = [];
  for (const partner of partners) {
    if (partner.status !== "active") continue;
    const rate = partner.regionRates?.[region];
    if (!rate) continue;

    const costMin = parseCostNumber(rate.costMin);
    if (costMin == null) continue;

    const costMaxRaw = parseCostNumber(rate.costMax);
    const codFee =
      partner.codSupported && partner.codFee
        ? parseCostNumber(partner.codFee) ?? 0
        : 0;

    candidates.push({
      partner,
      regionKey: region,
      estimatedDays: rate.estimatedDays,
      shippingFee: costMin,
      costMin,
      costMax:
        costMaxRaw != null && costMaxRaw !== costMin ? costMaxRaw : null,
      codSupported: partner.codSupported,
      codFee,
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
