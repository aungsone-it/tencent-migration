import { describe, expect, it } from "vitest";
import {
  computeVendorCommissionEarned,
  computeVendorPayoutAccrued,
  computeVendorPayoutEarned,
  isVendorOrderWithdrawable,
  orderLineGross,
  orderLineNetAfterDiscount,
} from "./vendorCommissionEarned";

describe("vendorCommissionEarned", () => {
  const products = [{ id: "p1", sku: "SKU1", commissionRate: 50 }];
  const vendorId = "v1";

  it("applies commission rate to product value only, not shipping", () => {
    const order = {
      status: "ready-to-ship",
      paymentStatus: "paid",
      paymentMethod: "kpay",
      inventoryDeducted: true,
      subtotal: 10,
      discount: 0,
      shippingFee: 5,
      total: 15,
      vendorId: "v1",
      items: [
        {
          productId: "p1",
          price: 10,
          quantity: 1,
          commissionRate: 50,
          vendorId: "v1",
        },
      ],
    };

    const platformCommission = computeVendorCommissionEarned([order], products, vendorId, 0);
    const vendorPayout = computeVendorPayoutEarned([order], products, vendorId, 0);

    expect(platformCommission).toBe(5);
    expect(vendorPayout).toBe(5);
  });

  it("uses proportional discount on line net before commission", () => {
    const order = {
      status: "fulfilled",
      paymentStatus: "paid",
      paymentMethod: "kpay",
      inventoryDeducted: true,
      subtotal: 100,
      discount: 10,
      shippingFee: 20,
      total: 110,
      vendorId: "v1",
      items: [
        {
          productId: "p1",
          price: 100,
          quantity: 1,
          commissionRate: 50,
          vendorId: "v1",
        },
      ],
    };

    const gross = orderLineGross(order.items[0]);
    const net = orderLineNetAfterDiscount(gross, order);
    expect(net).toBe(90);

    const vendorPayout = computeVendorPayoutEarned([order], products, vendorId, 0);
    expect(vendorPayout).toBe(45);
  });

  it("makes unpaid COD ready-to-ship withdrawable from order status alone", () => {
    const order = {
      status: "ready-to-ship",
      paymentStatus: "unpaid",
      paymentMethod: "cod",
      inventoryDeducted: true,
      subtotal: 2,
      discount: 0,
      shippingFee: 3000,
      total: 3002,
      vendorId: "v1",
      items: [
        {
          productId: "p1",
          price: 2,
          quantity: 1,
          subtotal: 2,
          commissionRate: 50,
        },
      ],
    };

    expect(isVendorOrderWithdrawable(order)).toBe(true);
    expect(computeVendorPayoutEarned([order], products, vendorId, 0)).toBe(1);
    expect(computeVendorPayoutAccrued([order], products, vendorId, 0)).toBe(1);
    expect(computeVendorCommissionEarned([order], products, vendorId, 0)).toBe(1);
  });

  it("counts vendor-admin SQL orders that omit vendorId and tag lines with the store name", () => {
    const order = {
      status: "Ready to Ship",
      paymentStatus: "unpaid",
      paymentMethod: "Cash on Delivery",
      subtotal: 2,
      total: 3002,
      items: [
        {
          productId: "test001",
          price: 2,
          quantity: 1,
          subtotal: 2,
          vendorId: "go go",
          commissionRate: 50,
        },
      ],
    };

    expect(computeVendorPayoutAccrued([order], products, "vendor_gogo_internal", 0)).toBe(1);
  });

  it("falls back to product subtotal when line items are missing", () => {
    const order = {
      status: "ready-to-ship",
      paymentStatus: "unpaid",
      paymentMethod: "cod",
      subtotal: 2,
      shippingFee: 3000,
      total: 3002,
      items: [],
    };

    expect(computeVendorPayoutAccrued([order], [], "vendor_gogo_internal", 50)).toBe(1);
  });
});
