import { describe, expect, it } from "vitest";
import {
  extractOrderCode,
  formatInvoiceBarcodeValue,
  formatOrderNumberDisplay,
  formatSerialOrderNumber,
  isPrefixedOrderNumber,
  normalizeOrderNumberSearch,
  ORDER_NUMBER_PREFIX,
  orderNumberSearchTokens,
} from "./orderNumber";

describe("orderNumber", () => {
  it("formats serial order numbers with zero padding", () => {
    expect(formatSerialOrderNumber(1)).toBe("NOS-00001");
    expect(formatSerialOrderNumber(999)).toBe("NOS-00999");
    expect(formatSerialOrderNumber(1000)).toBe("NOS-01000");
    expect(formatSerialOrderNumber(100001)).toBe("NOS-100001");
    expect(formatSerialOrderNumber(1, ORDER_NUMBER_PREFIX)).toBe("NOS-00001");
  });

  it("formats display order numbers as NOS-serial", () => {
    expect(formatOrderNumberDisplay("NOS-00001")).toBe("NOS-00001");
    expect(formatOrderNumberDisplay("NOS-0001")).toBe("NOS-00001");
    expect(formatOrderNumberDisplay("MOS-NOS-00001")).toBe("NOS-00001");
    expect(formatOrderNumberDisplay("MOS-0042")).toBe("NOS-00042");
    expect(formatOrderNumberDisplay("ORD-1000")).toBe("NOS-01000");
    expect(formatOrderNumberDisplay("MOS-MRFDNEWI")).toBe("MOS-MRFDNEWI");
  });

  it("formats invoice barcode using display format", () => {
    expect(formatInvoiceBarcodeValue("NOS-00007")).toBe("NOS-00007");
    expect(formatInvoiceBarcodeValue("#NOS-00010")).toBe("NOS-00010");
  });

  it("recognizes legacy and new prefixes for search", () => {
    expect(isPrefixedOrderNumber("ORD-00001")).toBe(true);
    expect(isPrefixedOrderNumber("MOS-00001")).toBe(true);
    expect(isPrefixedOrderNumber("NOS-00001")).toBe(true);
    expect(normalizeOrderNumberSearch("nos-00001")).toBe("NOS-00001");
    expect(normalizeOrderNumberSearch("random")).toBe("");
  });

  it("extracts serial or legacy order code", () => {
    expect(extractOrderCode("NOS-00001")).toBe("00001");
    expect(extractOrderCode("MOS-MRFDNEWI")).toBe("MRFDNEWI");
  });

  it("builds search tokens for serial numbers", () => {
    expect(orderNumberSearchTokens("NOS-00001")).toEqual(
      expect.arrayContaining(["nos-00001", "ord-00001", "mos-00001"])
    );
  });
});
