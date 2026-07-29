import { describe, expect, it } from "vitest";
import {
  isPaidSubscriptionPayment,
  paidSubscriptionPaymentDate,
  splitSubscriptionRevenue,
  subscriptionPaymentSplit,
} from "../../../supabase/functions/make-server-16010b6f/subscription_finance";

describe("subscription finance split", () => {
  it("pays 90% to the vendor and keeps 10% for NEXA", () => {
    expect(splitSubscriptionRevenue(1000)).toEqual({
      grossAmount: 1000,
      vendorPayout: 900,
      platformRevenue: 100,
    });
  });

  it("applies the same exact percentage to any whole-MMK plan price", () => {
    const split = splitSubscriptionRevenue(1001);
    expect(split).toEqual({
      grossAmount: 1001,
      vendorPayout: 900.9,
      platformRevenue: 100.1,
    });
    expect(split.vendorPayout + split.platformRevenue).toBe(split.grossAmount);
  });

  it("allocates two 10,000 MMK purchases across the three finance cards", () => {
    const purchases = [splitSubscriptionRevenue(10000), splitSubscriptionRevenue(10000)];
    expect(purchases.reduce((sum, split) => sum + split.grossAmount, 0)).toBe(20000);
    expect(purchases.reduce((sum, split) => sum + split.vendorPayout, 0)).toBe(18000);
    expect(purchases.reduce((sum, split) => sum + split.platformRevenue, 0)).toBe(2000);
  });

  it("calculates the split for paid records created before split fields existed", () => {
    expect(subscriptionPaymentSplit({ amount: 1000, status: "paid" })).toEqual({
      grossAmount: 1000,
      vendorPayout: 900,
      platformRevenue: 100,
    });
  });

  it("uses createdAt for historical paid records missing paidAt", () => {
    expect(
      paidSubscriptionPaymentDate({
        amount: 1000,
        status: "paid",
        createdAt: "2026-07-29T10:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-07-29T10:00:00.000Z");
  });

  it("normalizes historical paid status casing", () => {
    expect(isPaidSubscriptionPayment({ status: " Paid " })).toBe(true);
  });
});
