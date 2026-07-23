import { describe, expect, it } from "vitest";
import {
  categoryRouteSlugMatches,
  isVendorCategoryTabActive,
  normalizeCategoryRouteSlug,
  vendorCatalogFilterFromRouteSlug,
  vendorCategoryPathSegment,
  vendorCategoryUrlSlug,
} from "./vendorStoreCategory";

describe("vendorStoreCategory", () => {
  const burmeseCategory = {
    id: "category:vendor_abc:1710000000000",
    name: "အဝတ်အထည်",
  };

  it("keeps ASCII slug behavior for Latin names", () => {
    expect(vendorCategoryUrlSlug({ id: "category:v:1", name: "Home & Garden" })).toBe("home-garden");
    expect(vendorCategoryPathSegment("Cosmetic")).toBe("cosmetic");
  });

  it("uses stable c-{id} slug when Burmese name slugifies to empty", () => {
    expect(vendorCategoryUrlSlug(burmeseCategory)).toBe("c-1710000000000");
    expect(vendorCategoryPathSegment(burmeseCategory.name, burmeseCategory.id)).toBe("c-1710000000000");
  });

  it("matches Burmese category route without stripping script", () => {
    const routeSlug = "c-1710000000000";
    expect(normalizeCategoryRouteSlug(routeSlug)).toBe("c-1710000000000");
    expect(categoryRouteSlugMatches(routeSlug, burmeseCategory)).toBe(true);
    expect(isVendorCategoryTabActive(burmeseCategory, routeSlug)).toBe(true);
    expect(isVendorCategoryTabActive("all", routeSlug)).toBe(false);
  });

  it("resolves Burmese category filter from route slug", () => {
    const items = [burmeseCategory, { id: "category:v:2", name: "Cosmetic" }];
    expect(vendorCatalogFilterFromRouteSlug("c-1710000000000", items)).toBe("အဝတ်အထည်");
    expect(vendorCatalogFilterFromRouteSlug("cosmetic", items)).toBe("Cosmetic");
  });
});
