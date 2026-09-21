import { describe, expect, it } from "vitest";
import { joinStorefrontPath } from "./vendorStorePaths";

describe("joinStorefrontPath", () => {
  it("joins host-root storefront paths without double slashes", () => {
    expect(joinStorefrontPath("/", "product", "sku-1")).toBe("/product/sku-1");
    expect(joinStorefrontPath("/", "saved")).toBe("/saved");
    expect(joinStorefrontPath("/", "profile", "orders")).toBe("/profile/orders");
  });

  it("joins marketplace vendor paths", () => {
    expect(joinStorefrontPath("/vendor/nexa", "product", "sku-1")).toBe(
      "/vendor/nexa/product/sku-1",
    );
    expect(joinStorefrontPath("/vendor/go-go", "checkout")).toBe("/vendor/go-go/checkout");
  });
});
