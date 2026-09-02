import { describe, expect, it } from "vitest";
import {
  canAccessSuperAdminPage,
  canWriteSuperAdminSection,
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

  it("allows customer-services staff the expected nav pages", () => {
    expect(getAllowedSuperAdminPages("customer-services")).toEqual(
      new Set([
        "Home",
        "Product",
        "Categories",
        "Inventory",
        "Orders",
        "Promo Setting",
        "Chat",
        "Logistics",
      ])
    );
    expect(canAccessSuperAdminPage("customer-services", "Finances")).toBe(false);
    expect(canAccessSuperAdminPage("customer-services", "Settings")).toBe(false);
    expect(canAccessSuperAdminPage("customer-services", "Vendor")).toBe(false);
    expect(canAccessSuperAdminPage("customer-services", "Promo Setting")).toBe(true);
  });

  it("allows data-entry staff to access Promo Setting", () => {
    expect(getAllowedSuperAdminPages("data-entry")).toEqual(
      new Set([
        "Home",
        "Product",
        "Categories",
        "Inventory",
        "Promo Setting",
        "Chat",
        "Settings",
      ])
    );
    expect(canAccessSuperAdminPage("data-entry", "Promo Setting")).toBe(true);
    expect(canAccessSuperAdminPage("data-entry", "Orders")).toBe(false);
  });

  it("enforces read-only product and logistics for customer-services", () => {
    expect(canWriteSuperAdminSection("customer-services", "orders")).toBe(true);
    expect(canWriteSuperAdminSection("customer-services", "chat")).toBe(true);
    expect(canWriteSuperAdminSection("customer-services", "marketing")).toBe(true);
    expect(canWriteSuperAdminSection("customer-services", "product")).toBe(false);
    expect(canWriteSuperAdminSection("customer-services", "categories")).toBe(false);
    expect(canWriteSuperAdminSection("customer-services", "inventory")).toBe(false);
    expect(canWriteSuperAdminSection("customer-services", "logistics")).toBe(false);
  });

  it("grants full promo write access to data-entry", () => {
    expect(canWriteSuperAdminSection("data-entry", "marketing")).toBe(true);
    expect(canWriteSuperAdminSection("data-entry", "product")).toBe(true);
    expect(canWriteSuperAdminSection("data-entry", "orders")).toBe(false);
  });
});
