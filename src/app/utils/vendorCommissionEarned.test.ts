import { describe, expect, it } from "vitest";
import {
  computeVendorCommissionEarned,
  computeVendorPayoutEarned,
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
});
