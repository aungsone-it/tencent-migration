import { describe, expect, it } from "vitest";
import { buildVendorAdminUrl, validateSection } from "./routeValidation";

describe("vendor subscription admin route", () => {
  it("accepts subscriptions as a vendor admin section", () => {
    expect(validateSection("subscriptions")).toBe("subscriptions");
    expect(validateSection("subscription-plans")).toBe("subscription-plans");
    expect(validateSection("subscription-subscribers")).toBe("subscription-subscribers");
    expect(buildVendorAdminUrl("creator-store", "subscriptions")).toBe(
      "/vendor/creator-store/admin/subscriptions",
    );
  });
});
