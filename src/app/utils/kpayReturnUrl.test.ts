import { describe, expect, it, vi } from "vitest";
import {
  buildUnifiedKpaySummaryRedirectUrl,
  isBareUnifiedKpayApexHost,
  isUnifiedKpayReturnHost,
  resolveKpaySummaryPublicOrigin,
} from "./vendorCheckoutPaths";

describe("KPay unified return URL helpers", () => {
  it("treats bare and www platform apex as unified return hosts", () => {
    expect(isUnifiedKpayReturnHost("nexa-mm.com")).toBe(true);
    expect(isUnifiedKpayReturnHost("www.nexa-mm.com")).toBe(true);
    expect(isUnifiedKpayReturnHost("gogo.nexa-mm.com")).toBe(false);
  });

  it("flags bare apex without www for KBZ promotion", () => {
    expect(isBareUnifiedKpayApexHost("nexa-mm.com")).toBe(true);
    expect(isBareUnifiedKpayApexHost("www.nexa-mm.com")).toBe(false);
    expect(isBareUnifiedKpayApexHost("gogo.nexa-mm.com")).toBe(false);
  });

  it("builds www summary origin for vendor subdomain returns", () => {
    expect(resolveKpaySummaryPublicOrigin("gogo.nexa-mm.com")).toBe(
      "https://www.nexa-mm.com",
    );
  });

  it("builds vendor → apex summary redirect with order params", () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "gogo.nexa-mm.com",
        search: "",
        pathname: "/kpay/return",
      },
    });
    const url = buildUnifiedKpaySummaryRedirectUrl({
      pathname: "/kpay/return",
      search: "?merch_order_id=NOS-00200&prepay_id=abc",
    });
    expect(url).toBe(
      "https://www.nexa-mm.com/summary?merch_order_id=NOS-00200&prepay_id=abc",
    );
    vi.unstubAllGlobals();
  });
});
