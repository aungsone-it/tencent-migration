import { describe, expect, it } from "vitest";
import {
  extractVendorStorefrontProductSlug,
  isVendorStorefrontProductPath,
  vendorDashPrefixPathToSlash,
} from "./vendorStorefrontRoutePaths";

describe("vendorStorefrontRoutePaths", () => {
  it("detects marketplace and host-root product detail paths", () => {
    expect(isVendorStorefrontProductPath("/vendor/nexa/product/sku-1")).toBe(true);
    expect(isVendorStorefrontProductPath("/vendor-nexa/product/sku-1")).toBe(true);
    expect(isVendorStorefrontProductPath("/product/sku-1")).toBe(true);
    expect(isVendorStorefrontProductPath("/vendor/nexa/cosmetic")).toBe(false);
  });

  it("extracts product slug segments", () => {
    expect(extractVendorStorefrontProductSlug("/vendor/nexa/product/my-sku")).toBe("my-sku");
    expect(extractVendorStorefrontProductSlug("/vendor-nexa/product/my-sku")).toBe("my-sku");
    expect(extractVendorStorefrontProductSlug("/product/my-sku")).toBe("my-sku");
    expect(
      extractVendorStorefrontProductSlug("/vendor/nexa/product/my-sku", "/vendor/nexa"),
    ).toBe("my-sku");
  });

  it("canonicalizes legacy vendor- paths to slash form", () => {
    expect(vendorDashPrefixPathToSlash("/vendor-nexa/product/foo")).toBe(
      "/vendor/nexa/product/foo",
    );
    expect(vendorDashPrefixPathToSlash("/vendor-go-go")).toBe("/vendor/go-go");
  });
});
