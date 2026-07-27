import { describe, expect, it } from "vitest";
import {
  checkoutQualifiesForFreeShipping,
  resolveCategoryFreeShippingToggleTarget,
  resolveEffectiveCheckoutShippingFee,
  resolveProductFreeShippingForVendor,
  syncCategoryFreeShippingCounts,
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

  it("matches vendor aliases when resolving free shipping", () => {
    const product = { vendorFreeShipping: { migoo: true } };
    expect(resolveProductFreeShippingForVendor(product, "vendor_a", true, ["migoo"])).toBe(true);
    expect(
      resolveProductFreeShippingForVendor(product, "vendor_a", true, ["other-store"])
    ).toBe(false);
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

  it("turns all off when category free shipping is partial", () => {
    expect(
      resolveCategoryFreeShippingToggleTarget(
        { productIds: ["a", "b"], freeShippingEnabledCount: 1, freeShippingTotalCount: 2 },
        true
      )
    ).toBe(false);
  });

  it("syncs category free-shipping counts from product flags", () => {
    const categories = [
      {
        id: "cat-1",
        name: "Bags",
        productIds: ["p1", "p2", "p3"],
        freeShippingEnabledCount: 0,
        freeShippingTotalCount: 3,
      },
    ];
    const products = [
      { id: "p1", freeShipping: true },
      { id: "p2", freeShipping: false },
      { id: "p3", freeShipping: true },
    ];
    const synced = syncCategoryFreeShippingCounts(categories, products);
    expect(synced[0]?.freeShippingEnabledCount).toBe(2);
    expect(synced[0]?.freeShippingTotalCount).toBe(3);
  });
});
