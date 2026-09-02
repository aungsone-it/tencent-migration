import { describe, it, expect } from "vitest";
import {
  deriveOrderPaymentMethodKey,
  formatOrderPaymentMethodFromOrder,
  isKPayOrderLike,
} from "./orderPaymentMethod";

describe("orderPaymentMethod", () => {
  it("maps KBZPay QR orders", () => {
    expect(deriveOrderPaymentMethodKey({ paymentMethod: "KBZPay" })).toBe("kbz-qr");
    expect(
      formatOrderPaymentMethodFromOrder({ paymentMethod: "KBZPay" })
    ).toBe("KBZ QR Pay");
    expect(
      formatOrderPaymentMethodFromOrder({ paymentMethod: "credit-card", kpay: { merchantOrderId: "X" } })
    ).toBe("KBZ QR Pay");
  });

  it("maps other payment methods", () => {
    expect(deriveOrderPaymentMethodKey({ paymentMethod: "Cash on Delivery" })).toBe("cod");
    expect(deriveOrderPaymentMethodKey({ paymentMethod: "KBZPay (PWA)" })).toBe("kbz-pwa");
    expect(deriveOrderPaymentMethodKey({ paymentMethod: "Credit/Debit Card" })).toBe("credit-card");
  });

  it("detects KPay orders for invoice payment line", () => {
    expect(isKPayOrderLike({ paymentMethod: "KBZPay" })).toBe(true);
    expect(isKPayOrderLike({ paymentMethod: "KBZPay (PWA)" })).toBe(true);
    expect(isKPayOrderLike({ paymentMethod: "Cash on Delivery" })).toBe(false);
    expect(isKPayOrderLike({ paymentMethod: "cod" })).toBe(false);
    expect(isKPayOrderLike({ paymentMethod: "credit-card", kpay: { merchantOrderId: "X" } })).toBe(true);
  });
});
