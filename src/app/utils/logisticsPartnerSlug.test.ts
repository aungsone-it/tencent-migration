import { describe, expect, it } from "vitest";
import {
  findPartnerBySlug,
  formatLogisticsPartnerSlugLabel,
  logisticsPartnerProfilePath,
  logisticsPartnerToSlug,
} from "./logisticsPartnerSlug";

describe("logisticsPartnerSlug", () => {
  it("slugifies partner names", () => {
    expect(logisticsPartnerToSlug("Test Region 1")).toBe("test-region-1");
  });

  it("builds profile paths from names", () => {
    expect(
      logisticsPartnerProfilePath({ id: "logistics_abc", name: "Test Region 1" })
    ).toBe("/admin/logistics/test-region-1");
  });

  it("finds partners by slug or id", () => {
    const partners = [
      {
        id: "logistics_abc",
        name: "Test Region 1",
        logo: "",
        regionRates: {},
        status: "active" as const,
        codSupported: false,
        codFee: "",
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(findPartnerBySlug(partners, "test-region-1")?.id).toBe("logistics_abc");
    expect(findPartnerBySlug(partners, "logistics_abc")?.name).toBe("Test Region 1");
  });

  it("formats slug labels for breadcrumbs", () => {
    expect(formatLogisticsPartnerSlugLabel("test-region-1")).toBe("Test Region 1");
  });
});
