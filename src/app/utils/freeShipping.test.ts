import { describe, expect, it } from "vitest";
import {
  checkoutQualifiesForFreeShipping,
  resolveEffectiveCheckoutShippingFee,
  resolveProductFreeShippingForVendor,
  vendorHasFreeShippingAccess,
} from "./freeShipping";

describe("freeShipping", () => {
  it("detects vendor free-shipping access from super admin flag", () => {
    expect(vendorHasFreeShippingAccess({ freeShippingEnabled: true })).toBe(true);
    expect(vendorHasFreeShippingAccess({ freeShippingEnabled: false })).toBe(false);
    expect(vendorHasFreeShippingAccess(null)).toBe(false);
  });

  it("resolves product free shipping per vendor", () => {
    const product = { vendorFreeShipping: { vendor_a: true, vendor_b: false } };
    expect(resolveProductFreeShippingForVendor(product, "vendor_a", true)).toBe(true);
    expect(resolveProductFreeShippingForVendor(product, "vendor_b", true)).toBe(false);
    expect(resolveProductFreeShippingForVendor(product, "vendor_a", false)).toBe(false);
  });

  it("requires all checkout items to qualify for free shipping", () => {
    expect(
      checkoutQualifiesForFreeShipping([
        { freeShipping: true },
        { freeShipping: true },
      ])
    ).toBe(true);
    expect(
      checkoutQualifiesForFreeShipping([
        { freeShipping: true },
        { freeShipping: false },
      ])
    ).toBe(false);
  });

  it("overrides quoted logistics fee to zero when all items qualify", () => {
    expect(
      resolveEffectiveCheckoutShippingFee({
        quotedFee: 5000,
        checkoutItems: [{ freeShipping: true }],
      })
    ).toBe(0);
    expect(
      resolveEffectiveCheckoutShippingFee({
        quotedFee: 5000,
        checkoutItems: [{ freeShipping: true }, { freeShipping: false }],
      })
    ).toBe(5000);
  });
});
