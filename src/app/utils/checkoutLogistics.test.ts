import { describe, expect, it } from "vitest";
import {
  formatCheckoutShippingLabel,
  formatEstimatedDeliveryLabel,
  parseEstimatedDeliveryMaxDays,
  resolveCheckoutLogisticsQuote,
} from "./checkoutLogistics";
import type { DeliveryPartner } from "../../utils/api";

const partner: DeliveryPartner = {
  id: "logistics_test",
  name: "Test Region 1",
  logo: "",
  status: "active",
  codSupported: true,
  codFee: "500",
  regionRates: {
    Yangon: { estimatedDays: "2-3 days", costMin: "3000", costMax: "3500" },
    Mandalay: { estimatedDays: "5-10 days", costMin: "5000", costMax: "10000" },
  },
  createdAt: "",
  updatedAt: "",
};

describe("checkoutLogistics", () => {
  it("quotes the cheapest active partner for a region", () => {
    const quote = resolveCheckoutLogisticsQuote([partner], "Yangon");
    expect(quote?.shippingFee).toBe(3000);
    expect(quote?.estimatedDays).toBe("2-3 days");
    expect(quote?.codSupported).toBe(true);
    expect(quote?.codFee).toBe(500);
  });

  it("returns null when region is not covered", () => {
    expect(resolveCheckoutLogisticsQuote([partner], "Chin")).toBeNull();
  });

  it("formats shipping range labels", () => {
    const quote = resolveCheckoutLogisticsQuote([partner], "Yangon");
    expect(
      formatCheckoutShippingLabel(quote, (n) => `${n.toLocaleString()} ကျပ်`)
    ).toBe("3,000 ကျပ် – 3,500 ကျပ်");
  });

  it("uses the max day from estimated delivery ranges", () => {
    expect(parseEstimatedDeliveryMaxDays("2-3 days")).toBe(3);
    expect(parseEstimatedDeliveryMaxDays("3 to 10 days")).toBe(10);
    expect(parseEstimatedDeliveryMaxDays("5 days")).toBe(5);
    expect(formatEstimatedDeliveryLabel("2-3 days", (days) => `${days} ရက်အတွင်း`)).toBe(
      "3 ရက်အတွင်း"
    );
    expect(formatEstimatedDeliveryLabel("3 to 10 days", (days) => `${days} ရက်အတွင်း`)).toBe(
      "10 ရက်အတွင်း"
    );
  });
});
