import { describe, expect, it } from "vitest";
import {
  canAccessSuperAdminPage,
  getAllowedSuperAdminPages,
} from "./superAdminRolePermissions";

describe("superAdminRolePermissions", () => {
  it("allows warehouse staff to access Logistics", () => {
    expect(canAccessSuperAdminPage("warehouse", "Logistics")).toBe(true);
    expect(canAccessSuperAdminPage("Warehouse", "Logistics")).toBe(true);
    expect(canAccessSuperAdminPage(" WAREHOUSE ", "Logistics")).toBe(true);
  });

  it("limits warehouse staff to fulfillment pages only", () => {
    expect(getAllowedSuperAdminPages("warehouse")).toEqual(
      new Set(["Home", "Orders", "Inventory", "Logistics"])
    );
    expect(canAccessSuperAdminPage("warehouse", "Finances")).toBe(false);
    expect(canAccessSuperAdminPage("warehouse", "Settings")).toBe(false);
    expect(canAccessSuperAdminPage("warehouse", "Product")).toBe(false);
  });
});
