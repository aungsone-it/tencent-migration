import { describe, expect, it } from "vitest";
import {
  formatCheckoutShippingLabel,
  formatEstimatedDeliveryLabel,
  listCheckoutLogisticsQuotes,
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

  it("uses township exception price when configured", () => {
    const withExceptions: DeliveryPartner = {
      ...partner,
      regionRates: {
        Yangon: {
          estimatedDays: "2-3 days",
          costMin: "4000",
          costMax: "",
          townshipExceptions: {
            Mingaladon: { costMin: "5000", costMax: "" },
            Dala: { costMin: "5000", costMax: "" },
          },
        },
      },
    };
    const defaultQuote = resolveCheckoutLogisticsQuote([withExceptions], "Yangon", "Kamayut");
    expect(defaultQuote?.shippingFee).toBe(4000);
    expect(defaultQuote?.isTownshipException).toBe(false);

    const exceptionQuote = resolveCheckoutLogisticsQuote(
      [withExceptions],
      "Yangon",
      "Mingaladon"
    );
    expect(exceptionQuote?.shippingFee).toBe(5000);
    expect(exceptionQuote?.isTownshipException).toBe(true);

    const burmeseQuote = resolveCheckoutLogisticsQuote(
      [withExceptions],
      "Yangon",
      "ဒလ"
    );
    expect(burmeseQuote?.shippingFee).toBe(5000);
    expect(burmeseQuote?.isTownshipException).toBe(true);
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

  it("lists all partner quotes sorted by price", () => {
    const cheaper: DeliveryPartner = {
      ...partner,
      id: "cheap",
      name: "Cheap Carrier",
      regionRates: {
        Yangon: { estimatedDays: "2 days", costMin: "2000", costMax: "" },
      },
    };
    const pricier: DeliveryPartner = {
      ...partner,
      id: "premium",
      name: "Premium Carrier",
      regionRates: {
        Yangon: { estimatedDays: "1 day", costMin: "5000", costMax: "" },
      },
    };

    const quotes = listCheckoutLogisticsQuotes([pricier, cheaper], "Yangon");
    expect(quotes.map((quote) => quote.partner.id)).toEqual(["cheap", "premium"]);
  });

  it("returns the selected partner quote when partnerId is provided", () => {
    const cheaper: DeliveryPartner = {
      ...partner,
      id: "cheap",
      name: "Cheap Carrier",
      regionRates: {
        Yangon: { estimatedDays: "2 days", costMin: "2000", costMax: "" },
      },
    };
    const pricier: DeliveryPartner = {
      ...partner,
      id: "premium",
      name: "Premium Carrier",
      regionRates: {
        Yangon: { estimatedDays: "1 day", costMin: "5000", costMax: "" },
      },
    };

    const quote = resolveCheckoutLogisticsQuote(
      [cheaper, pricier],
      "Yangon",
      undefined,
      "premium"
    );
    expect(quote?.partner.id).toBe("premium");
    expect(quote?.shippingFee).toBe(5000);
  });
});
