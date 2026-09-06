import { describe, expect, it } from "vitest";
import {
  isImmediatePlacementMethod,
  isPwaPlacementMethod,
  normalizeCheckoutPaymentMethod,
  resolveCheckoutSummaryPlacement,
} from "./checkoutSummaryPlacement";

const codSnapshot = { orderNumber: "NOS-00118", paymentMethod: "COD" as const };
const qrSnapshot = { orderNumber: "NOS-00120", paymentMethod: "KPay" as const };
const pwaSnapshot = { orderNumber: "NOS-00200", paymentMethod: "KPay-PWA" as const };

describe("normalizeCheckoutPaymentMethod", () => {
  it("keeps COD, QR, and PWA distinct", () => {
    expect(normalizeCheckoutPaymentMethod("COD")).toBe("COD");
    expect(normalizeCheckoutPaymentMethod("KBZPay")).toBe("KPay");
    expect(normalizeCheckoutPaymentMethod("KBZPay (PWA)")).toBe("KPay-PWA");
    expect(isImmediatePlacementMethod("COD")).toBe(true);
    expect(isImmediatePlacementMethod("KPay")).toBe(true);
    expect(isImmediatePlacementMethod("KPay-PWA")).toBe(false);
    expect(isPwaPlacementMethod("KPay-PWA")).toBe(true);
  });
});

describe("resolveCheckoutSummaryPlacement", () => {
  it("keeps a just-placed COD summary even if a leftover PWA draft exists", () => {
    const result = resolveCheckoutSummaryPlacement({
      urlOrderId: "",
      urlPrepayId: "",
      pendingMerchantOrderId: "NOS-00200",
      pendingHasDraft: true,
      pathSnapshot: codSnapshot,
      latestSnapshot: codSnapshot,
    });
    expect(result).toEqual({
      snapshot: codSnapshot,
      pendingOrderId: "",
      fromPersistedSnapshot: true,
    });
  });

  it("keeps a just-placed QR summary even if a leftover PWA draft exists", () => {
    const result = resolveCheckoutSummaryPlacement({
      urlOrderId: "",
      urlPrepayId: "",
      pendingMerchantOrderId: "NOS-00200",
      pendingHasDraft: true,
      pathSnapshot: qrSnapshot,
      latestSnapshot: qrSnapshot,
    });
    expect(result.snapshot?.orderNumber).toBe("NOS-00120");
    expect(result.pendingOrderId).toBe("");
  });

  it("does not let a leftover COD snapshot steal a PWA return", () => {
    const result = resolveCheckoutSummaryPlacement({
      urlOrderId: "NOS-00200",
      urlPrepayId: "prepay_abc",
      pendingMerchantOrderId: "NOS-00200",
      pendingHasDraft: true,
      pathSnapshot: codSnapshot,
      latestSnapshot: codSnapshot,
    });
    expect(result).toEqual({
      snapshot: null,
      pendingOrderId: "NOS-00200",
      fromPersistedSnapshot: false,
    });
  });

  it("uses the matching PWA snapshot when KBZ returns that order id", () => {
    const result = resolveCheckoutSummaryPlacement({
      urlOrderId: "NOS-00200",
      urlPrepayId: "prepay_abc",
      pendingMerchantOrderId: "NOS-00200",
      pendingHasDraft: true,
      pathSnapshot: pwaSnapshot,
      latestSnapshot: codSnapshot,
    });
    expect(result).toEqual({
      snapshot: pwaSnapshot,
      pendingOrderId: "NOS-00200",
      fromPersistedSnapshot: true,
    });
  });

  it("uses the PWA draft when there is no URL and no COD/QR snapshot", () => {
    const result = resolveCheckoutSummaryPlacement({
      urlOrderId: "",
      urlPrepayId: "",
      pendingMerchantOrderId: "NOS-00200",
      pendingHasDraft: true,
      pathSnapshot: null,
      latestSnapshot: null,
    });
    expect(result).toEqual({
      snapshot: null,
      pendingOrderId: "NOS-00200",
      fromPersistedSnapshot: false,
    });
  });
});
