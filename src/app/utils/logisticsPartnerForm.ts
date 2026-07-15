import type { DeliveryPartner } from "../../utils/api";
import type { RegionShippingRate } from "./logisticsRegions";

export type RegionRateForm = RegionShippingRate;

export type PartnerForm = {
  name: string;
  logo: string;
  status: "active" | "inactive";
  codSupported: boolean;
  codFee: string;
  regionRates: Record<string, RegionRateForm>;
};

export const emptyRegionRate = (): RegionRateForm => ({
  estimatedDays: "",
  costMin: "",
  costMax: "",
});

export const emptyPartnerForm = (): PartnerForm => ({
  name: "",
  logo: "",
  status: "active",
  codSupported: false,
  codFee: "",
  regionRates: {},
});

export function partnerToForm(partner: DeliveryPartner): PartnerForm {
  const regionRates: Record<string, RegionRateForm> = {};
  for (const [region, rate] of Object.entries(partner.regionRates || {})) {
    regionRates[region] = {
      estimatedDays: rate.estimatedDays,
      costMin: rate.costMin,
      costMax: rate.costMax,
    };
  }
  return {
    name: partner.name,
    logo: partner.logo,
    status: partner.status,
    codSupported: partner.codSupported,
    codFee: partner.codFee,
    regionRates,
  };
}

export function formToPayload(form: PartnerForm) {
  const regionRates: Record<string, RegionShippingRate> = {};
  for (const [region, rate] of Object.entries(form.regionRates)) {
    regionRates[region] = {
      estimatedDays: rate.estimatedDays.trim(),
      costMin: rate.costMin.trim(),
      costMax: rate.costMax.trim(),
    };
  }
  return {
    name: form.name.trim(),
    logo: form.logo.trim(),
    status: form.status,
    codSupported: form.codSupported,
    codFee: form.codSupported ? form.codFee.trim() : "",
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
