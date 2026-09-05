import { describe, expect, it } from "vitest";
import {
  platformCommissionExcludingShipping,
  vendorPayoutExcludingShipping,
} from "./vendorPayoutFromTransaction";

describe("vendorPayoutExcludingShipping", () => {
  it("excludes shipping from a stale order-total payout (NOS-00131 shape)", () => {
    const txn = {
      amount: 3002,
      commission: 1,
      vendorPayout: 3001,
      products: [{ productId: "test001", price: 2, quantity: 1, subtotal: 2 }],
    };
    expect(vendorPayoutExcludingShipping(txn)).toBe(1);
    expect(platformCommissionExcludingShipping(txn)).toBe(1);
  });

  it("keeps stored payout when line items are missing", () => {
    expect(
      vendorPayoutExcludingShipping({
        amount: 3002,
        commission: 1,
        vendorPayout: 2500,
      }),
    ).toBe(2500);
  });

  it("returns product net when commission is zero", () => {
    expect(
      vendorPayoutExcludingShipping({
        amount: 3002,
        commission: 0,
        vendorPayout: 3002,
        items: [{ price: 2, quantity: 1 }],
      }),
    ).toBe(2);
  });
});
