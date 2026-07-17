import type { DeliveryPartner } from "../../utils/api";
import type { RegionShippingRate, TownshipShippingRate } from "./logisticsRegions";
import { normalizeTownshipKey } from "./myanmarRegions";

export type TownshipRateForm = TownshipShippingRate;

export type RegionRateForm = RegionShippingRate;

export type PartnerForm = {
  name: string;
  logo: string;
  status: "active" | "inactive";
  codSupported: boolean;
  regionRates: Record<string, RegionRateForm>;
};

export function normalizePartnerStatus(value: unknown): "active" | "inactive" {
  return String(value || "active").toLowerCase() === "inactive" ? "inactive" : "active";
}

export const emptyTownshipRate = (): TownshipRateForm => ({
  costMin: "",
  costMax: "",
});

export const emptyRegionRate = (): RegionRateForm => ({
  estimatedDays: "",
  costMin: "",
  costMax: "",
  townshipExceptions: {},
});

export const emptyPartnerForm = (): PartnerForm => ({
  name: "",
  logo: "",
  status: "active",
  codSupported: false,
  regionRates: {},
});

function stripEmptyTownshipExceptions(form: PartnerForm): PartnerForm {
  const regionRates: Record<string, RegionRateForm> = {};
  for (const [region, rate] of Object.entries(form.regionRates)) {
    const townshipExceptions: Record<string, TownshipRateForm> = {};
    for (const [township, exception] of Object.entries(rate.townshipExceptions || {})) {
      const costMin = String(exception?.costMin || "").trim();
      const costMax = String(exception?.costMax || "").trim();
      if (costMin || costMax) {
        townshipExceptions[township] = { costMin, costMax };
      }
    }
    regionRates[region] = { ...rate, townshipExceptions };
  }
  return { ...form, regionRates };
}

export function sanitizePartnerForm(form: PartnerForm): PartnerForm {
  return stripEmptyTownshipExceptions(form);
}

function normalizeTownshipExceptionsForRegion(
  region: string,
  raw: Record<string, TownshipRateForm> | undefined
): Record<string, TownshipRateForm> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, TownshipRateForm> = {};
  for (const [township, rate] of Object.entries(raw)) {
    const key = normalizeTownshipKey(region, township) || String(township || "").trim();
    if (!key) continue;
    const costMin = String(rate?.costMin || "").trim();
    const costMax = String(rate?.costMax || "").trim();
    if (!costMin) continue;
    out[key] = { costMin, costMax };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function partnerToForm(partner: DeliveryPartner): PartnerForm {
  const regionRates: Record<string, RegionRateForm> = {};
  for (const [region, rate] of Object.entries(partner.regionRates || {})) {
    regionRates[region] = {
      estimatedDays: rate.estimatedDays,
      costMin: rate.costMin,
      costMax: rate.costMax,
      townshipExceptions: rate.townshipExceptions
        ? Object.fromEntries(
            Object.entries(rate.townshipExceptions).map(([township, ex]) => [
              normalizeTownshipKey(region, township) || township,
              { costMin: ex.costMin, costMax: ex.costMax },
            ])
          )
        : {},
    };
  }
  return {
    name: partner.name,
    logo: partner.logo,
    status: normalizePartnerStatus(partner.status),
    codSupported: partner.codSupported,
    regionRates,
  };
}

export function partnerToUpdatePayload(
  partner: DeliveryPartner
): Omit<DeliveryPartner, "id" | "createdAt" | "updatedAt"> {
  return formToPayload(partnerToForm(partner));
}

export function countPartnerTownshipExceptions(form: PartnerForm): number {
  let total = 0;
  for (const rate of Object.values(form.regionRates)) {
    for (const exception of Object.values(rate.townshipExceptions || {})) {
      if (String(exception?.costMin || "").trim()) total += 1;
    }
  }
  return total;
}

export function formToPayload(form: PartnerForm) {
  const regionRates: Record<string, RegionShippingRate> = {};
  for (const [region, rate] of Object.entries(form.regionRates)) {
    const townshipExceptions = normalizeTownshipExceptionsForRegion(
      region,
      rate.townshipExceptions
    );
    regionRates[region] = {
      estimatedDays: rate.estimatedDays.trim(),
      costMin: rate.costMin.trim(),
      costMax: rate.costMax.trim(),
      ...(townshipExceptions ? { townshipExceptions } : {}),
    };
  }
  return {
    name: form.name.trim(),
    logo: form.logo.trim(),
    status: normalizePartnerStatus(form.status),
    codSupported: form.codSupported,
    codFee: "",
    regionRates,
  };
}

export function validatePartnerForm(form: PartnerForm): string | null {
  if (!form.name.trim()) return "Company / service name is required";

  const regions = Object.keys(form.regionRates);
  if (regions.length === 0) {
    return "Add at least one region with delivery time and price";
  }

  for (const region of regions) {
    const rate = form.regionRates[region];
    if (!rate.estimatedDays.trim()) {
      return `Estimated delivery is required for ${region}`;
    }
    if (!rate.costMin.trim()) {
      return `Minimum shipping cost is required for ${region}`;
    }

    for (const [township, exception] of Object.entries(rate.townshipExceptions || {})) {
      const costMin = String(exception?.costMin || "").trim();
      const costMax = String(exception?.costMax || "").trim();
      if (!costMin && !costMax) continue;
      if (!costMin) {
        return `Minimum shipping cost is required for ${township} (${region} exception)`;
      }
    }
  }

  return null;
}

export function logisticsApiErrorMessage(
  error: unknown,
  action: "load" | "save" | "delete"
): string {
  const fallback =
    action === "load"
      ? "Failed to load delivery partners"
      : action === "delete"
        ? "Failed to remove delivery partner"
        : "Failed to save delivery partner";

  if (!(error instanceof Error)) return fallback;

  const msg = error.message.trim();
  if (/not found|404|not deployed/i.test(msg)) {
    return "Logistics API is not deployed yet. Run: npm run deploy:functions — then try again.";
  }
  return msg || fallback;
}
