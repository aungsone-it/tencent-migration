import { describe, expect, it } from "vitest";
import {
  aggregateVendorPayoutsFromTransactions,
  isAccruedFinancesOrder,
  isCancelledFinancesOrder,
  vendorPayoutDisplayStatus,
} from "./financesOrderStatus";

describe("financesOrderStatus", () => {
  it("treats cancelled orders as excluded from totals", () => {
    expect(isCancelledFinancesOrder("cancelled")).toBe(true);
    expect(isCancelledFinancesOrder("Canceled")).toBe(true);
  });

  it("includes confirmed pipeline statuses in accrued revenue", () => {
    expect(isAccruedFinancesOrder("ready-to-ship")).toBe(true);
    expect(isAccruedFinancesOrder("fulfilled")).toBe(true);
    expect(isAccruedFinancesOrder("shipped")).toBe(true);
    expect(isAccruedFinancesOrder("processing")).toBe(true);
  });

  it("excludes pending and cancelled from accrued revenue", () => {
    expect(isAccruedFinancesOrder("pending")).toBe(false);
    expect(isAccruedFinancesOrder("pending-payment")).toBe(false);
    expect(isAccruedFinancesOrder("cancelled")).toBe(false);
  });

  it("maps payout row status from order pipeline", () => {
    expect(vendorPayoutDisplayStatus(["processing"])).toBe("pending");
    expect(vendorPayoutDisplayStatus(["ready-to-ship"])).toBe("accrued");
    expect(vendorPayoutDisplayStatus(["delivered", "completed"])).toBe("completed");
  });

  it("aggregates accrued vendor payouts and skips pending checkout noise", () => {
    const rows = aggregateVendorPayoutsFromTransactions([
      { vendorId: "v1", vendor: "Shop A", vendorPayout: 1000, status: "pending" },
      { vendorId: "v1", vendor: "Shop A", vendorPayout: 2500, status: "ready-to-ship" },
      { vendorId: "v1", vendor: "Shop A", vendorPayout: 500, status: "cancelled" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payout).toBe(2500);
    expect(rows[0].orders).toBe(1);
    expect(rows[0].status).toBe("accrued");
  });
});
