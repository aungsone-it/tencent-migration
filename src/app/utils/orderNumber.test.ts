import { describe, expect, it } from "vitest";
import {
  buildOrderNumber,
  extractOrderCode,
  formatOrderNumberDisplay,
  formatInvoiceBarcodeValue,
  isPrefixedOrderNumber,
  normalizeOrderNumberSearch,
  ORDER_NUMBER_PREFIX,
} from "./orderNumber";

describe("orderNumber", () => {
  it("builds MOS-prefixed ids", () => {
    expect(buildOrderNumber()).toMatch(/^MOS-[A-Z0-9]+$/);
    expect(buildOrderNumber(ORDER_NUMBER_PREFIX)).toMatch(/^MOS-[A-Z0-9]+$/);
  });

  it("formats display order numbers as MOS-code", () => {
    expect(formatOrderNumberDisplay("ORD-MRFDNEWI")).toBe("MOS-MRFDNEWI");
    expect(formatOrderNumberDisplay("MOS-MRFDNEWI")).toBe("MOS-MRFDNEWI");
  });

  it("formats invoice barcode as MOS-code", () => {
    expect(formatInvoiceBarcodeValue("ORD-MRFDNEWI")).toBe("MOS-MRFDNEWI");
    expect(formatInvoiceBarcodeValue("MOS-MRFDNEWI")).toBe("MOS-MRFDNEWI");
    expect(formatInvoiceBarcodeValue("#MOS-MRFAE7K0")).toBe("MOS-MRFAE7K0");
  });

  it("recognizes legacy and new prefixes for search", () => {
    expect(isPrefixedOrderNumber("ORD-MRFDNEWI")).toBe(true);
    expect(isPrefixedOrderNumber("MOS-MRFDNEWI")).toBe(true);
    expect(normalizeOrderNumberSearch("mos-mrfae7k0")).toBe("MOS-MRFAE7K0");
    expect(normalizeOrderNumberSearch("random")).toBe("");
  });

  it("extracts bare order code", () => {
    expect(extractOrderCode("ORD-MRFDNEWI")).toBe("MRFDNEWI");
    expect(extractOrderCode("MOS-MRFDNEWI")).toBe("MRFDNEWI");
  });
});
