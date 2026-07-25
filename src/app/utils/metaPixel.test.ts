import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./module-cache", () => ({
  fetchVendorProducts: vi.fn(),
}));

describe("metaPixel", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("configures and initializes each pixel only once", async () => {
    const fbq = vi.fn();
    vi.stubGlobal("window", { fbq });
    const { initMetaPixel } = await import("./metaPixel");

    initMetaPixel("123456789");
    initMetaPixel("123456789");
    initMetaPixel("123456789");

    expect(fbq.mock.calls).toEqual([
      ["set", "autoConfig", false, "123456789"],
      ["init", "123456789", {}, { autoConfig: false }],
    ]);
  });

  it("keeps initialization dedupe state across module reloads", async () => {
    const fbq = vi.fn();
    const browserWindow: Record<string, unknown> = { fbq };
    vi.stubGlobal("window", browserWindow);

    const firstModule = await import("./metaPixel");
    firstModule.initMetaPixel("123456789");
    vi.resetModules();
    const reloadedModule = await import("./metaPixel");
    reloadedModule.initMetaPixel("123456789");

    expect(fbq.mock.calls).toEqual([
      ["set", "autoConfig", false, "123456789"],
      ["init", "123456789", {}, { autoConfig: false }],
    ]);
  });

  it("fires PageView only once for the active pixel", async () => {
    const fbq = vi.fn();
    vi.stubGlobal("window", { fbq });
    const { initMetaPixel, trackMetaPageView } = await import("./metaPixel");

    initMetaPixel("123456789");
    fbq.mockClear();
    trackMetaPageView("/store");
    trackMetaPageView("/store/product/example");

    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith("track", "PageView", {
      page_path: "/store",
    });
  });

  it("does not repeat PageView after a hard refresh in the same tab", async () => {
    const fbq = vi.fn();
    const sessionValues = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => sessionValues.get(key) ?? null,
      setItem: (key: string, value: string) => sessionValues.set(key, value),
    });
    vi.stubGlobal("window", { fbq });

    const firstPage = await import("./metaPixel");
    firstPage.initMetaPixel("123456789");
    firstPage.trackMetaPageView("/store");

    vi.resetModules();
    vi.stubGlobal("window", { fbq });
    const refreshedPage = await import("./metaPixel");
    refreshedPage.initMetaPixel("123456789");
    refreshedPage.trackMetaPageView("/store/product/example");

    const pageViews = fbq.mock.calls.filter(
      (call) => call[0] === "track" && call[1] === "PageView"
    );
    expect(pageViews).toHaveLength(1);
  });

  it("emits only the requested semantic commerce events", async () => {
    const fbq = vi.fn();
    vi.stubGlobal("window", { fbq });
    const {
      initMetaPixel,
      trackMetaAddToCart,
      trackMetaBuyNow,
      trackMetaCategoryFilter,
      trackMetaSearch,
      trackMetaViewContent,
    } = await import("./metaPixel");

    initMetaPixel("123456789");
    fbq.mockClear();
    trackMetaViewContent({ id: "p1", name: "Shoe", price: 1000 });
    trackMetaAddToCart({
      id: "p1",
      sku: "red",
      name: "Shoe",
      price: 1000,
      quantity: 2,
    });
    trackMetaBuyNow({
      id: "p1",
      sku: "red",
      name: "Shoe",
      price: 1000,
      quantity: 2,
    });
    trackMetaSearch(" running shoe ");
    trackMetaCategoryFilter("Footwear");

    expect(fbq.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["track", "ViewContent"],
      ["track", "AddToCart"],
      ["trackCustom", "BuyNow"],
      ["track", "Search"],
      ["trackCustom", "FilterByCategory"],
    ]);
    expect(fbq).toHaveBeenCalledWith("track", "Search", {
      search_string: "running shoe",
    });
    expect(fbq).toHaveBeenCalledWith("trackCustom", "FilterByCategory", {
      content_category: "Footwear",
    });
  });

  it("deduplicates reruns without suppressing another pixel", async () => {
    const fbq = vi.fn();
    vi.stubGlobal("window", { fbq });
    const { initMetaPixel, trackMetaSearch } = await import("./metaPixel");

    initMetaPixel("123456789");
    fbq.mockClear();
    trackMetaSearch("shoe");
    trackMetaSearch("shoe");
    initMetaPixel("987654321");
    trackMetaSearch("shoe");

    const searchCalls = fbq.mock.calls.filter(
      (call) => call[0] === "track" && call[1] === "Search"
    );
    expect(searchCalls).toHaveLength(2);
  });

  it("does not track empty searches or the all-category state", async () => {
    const fbq = vi.fn();
    vi.stubGlobal("window", { fbq });
    const {
      initMetaPixel,
      trackMetaCategoryFilter,
      trackMetaSearch,
    } = await import("./metaPixel");

    initMetaPixel("123456789");
    fbq.mockClear();
    trackMetaSearch("   ");
    trackMetaCategoryFilter("");
    trackMetaCategoryFilter("all");

    expect(fbq).not.toHaveBeenCalled();
  });
});
