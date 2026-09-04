import { describe, expect, it } from "vitest";
import {
  productHasExplicitCommissionRate,
  resolveLineCommissionPercentFromProducts,
} from "./commissionRate";
import {
  computeVendorPayoutEarned,
  computeVendorCommissionEarned,
} from "./vendorCommissionEarned";

describe("commissionRate resolution", () => {
  const vendorContract = 20;
  const products = [
    { id: "p-fixed", sku: "FIXED", commissionRate: 50 },
    { id: "p-blank", sku: "BLANK" },
  ];

  const baseOrder = {
    status: "ready-to-ship",
    paymentStatus: "paid",
    paymentMethod: "kpay",
    inventoryDeducted: true,
    subtotal: 10,
    discount: 0,
    shippingFee: 0,
    total: 10,
    vendorId: "v1",
  };

  it("uses product fixed rate and ignores vendor contract", () => {
    const pct = resolveLineCommissionPercentFromProducts(
      { productId: "p-fixed", price: 10, quantity: 1, commissionRate: 50 },
      products,
      vendorContract,
    );
    expect(pct).toBe(50);
  });

  it("falls back to vendor contract when product commission is blank", () => {
    expect(productHasExplicitCommissionRate(products[1])).toBe(false);
    const pct = resolveLineCommissionPercentFromProducts(
      { productId: "p-blank", price: 10, quantity: 1 },
      products,
      vendorContract,
    );
    expect(pct).toBe(20);
  });

  it("does not treat embedded product commissionRate: 0 as explicit product override", () => {
    const pct = resolveLineCommissionPercentFromProducts(
      {
        productId: "p-blank",
        price: 10,
        quantity: 1,
        product: { commissionRate: 0 },
      },
      products,
      vendorContract,
    );
    expect(pct).toBe(20);
  });

  it("honours explicit product 0% when set on catalog product", () => {
    const pct = resolveLineCommissionPercentFromProducts(
      { productId: "p-zero", price: 10, quantity: 1 },
      [{ id: "p-zero", commissionRate: 0 }],
      vendorContract,
    );
    expect(pct).toBe(0);
  });

  it("computes vendor payout from product value only with correct rate tier", () => {
    const orderFixed = {
      ...baseOrder,
      items: [{ productId: "p-fixed", price: 10, quantity: 1, commissionRate: 50, vendorId: "v1" }],
    };
    const orderBlank = {
      ...baseOrder,
      items: [{ productId: "p-blank", price: 10, quantity: 1, vendorId: "v1" }],
    };

    expect(computeVendorPayoutEarned([orderFixed], products, "v1", vendorContract)).toBe(5);
    expect(computeVendorPayoutEarned([orderBlank], products, "v1", vendorContract)).toBe(8);
    expect(computeVendorCommissionEarned([orderFixed], products, "v1", vendorContract)).toBe(5);
    expect(computeVendorCommissionEarned([orderBlank], products, "v1", vendorContract)).toBe(2);
  });
});
