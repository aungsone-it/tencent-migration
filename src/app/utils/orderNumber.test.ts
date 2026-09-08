import { describe, expect, it } from "vitest";
import {
  compareOrdersBySerial,
  extractOrderCode,
  formatInvoiceBarcodeValue,
  formatOrderNumberDisplay,
  formatSerialOrderNumber,
  isPrefixedOrderNumber,
  normalizeOrderNumberSearch,
  ORDER_NUMBER_PREFIX,
  orderNumberSearchTokens,
  parseOrderSerial,
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

  it("parses numeric serials from prefixed order numbers", () => {
    expect(parseOrderSerial("NOS-00188")).toBe(188);
    expect(parseOrderSerial("MOS-NOS-00118")).toBe(118);
    expect(parseOrderSerial("ORD-00001")).toBe(1);
    expect(parseOrderSerial("MOS-MRFDNEWI")).toBe(0);
  });

  it("slots a recovered draft into serial order instead of the top", () => {
    const listed = [
      { orderNumber: "NOS-00100" },
      { orderNumber: "NOS-00099" },
      { orderNumber: "NOS-00097" },
    ];
    const recovered = { orderNumber: "NOS-00098" };
    const next = [...listed, recovered].sort((a, b) => compareOrdersBySerial(a, b, "newest"));
    expect(next.map((row) => row.orderNumber)).toEqual([
      "NOS-00100",
      "NOS-00099",
      "NOS-00098",
      "NOS-00097",
    ]);
  });

  it("builds search tokens for serial numbers", () => {
    expect(orderNumberSearchTokens("NOS-00001")).toEqual(
      expect.arrayContaining(["nos-00001", "ord-00001", "mos-00001"])
    );
  });
});
