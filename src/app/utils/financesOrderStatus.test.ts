import { describe, expect, it } from "vitest";
import {
  isAccruedFinancesOrder,
  isCancelledFinancesOrder,
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
});
