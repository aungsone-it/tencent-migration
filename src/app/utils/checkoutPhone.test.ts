import { describe, expect, it } from "vitest";
import {
  formatCheckoutPhoneDisplay,
  normalizeCheckoutPhone,
  normalizeMyanmarPhone,
} from "./customerAuthIdentity";

describe("normalizeCheckoutPhone", () => {
  it("accepts standard Myanmar mobile numbers", () => {
    expect(normalizeCheckoutPhone("09440226433")).toBe("+959440226433");
    expect(normalizeCheckoutPhone("+959440226433")).toBe("+959440226433");
    expect(normalizeCheckoutPhone("094 402 264 33")).toBe("+959440226433");
  });

  it("accepts 9-digit mobile shorthand without leading 0", () => {
    expect(normalizeCheckoutPhone("9440226433")).toBe("+959440226433");
    expect(normalizeCheckoutPhone("440226433")).toBe("+959440226433");
  });

  it("accepts short local numbers (5, 6, 7 digits)", () => {
    expect(normalizeCheckoutPhone("12345")).toBe("12345");
    expect(normalizeCheckoutPhone("123456")).toBe("123456");
    expect(normalizeCheckoutPhone("1234567")).toBe("1234567");
  });

  it("accepts 9-digit local numbers that are not mobile", () => {
    expect(normalizeCheckoutPhone("123456789")).toBe("123456789");
  });

  it("accepts landlines with leading 0", () => {
    expect(normalizeCheckoutPhone("012345678")).toBe("012345678");
    expect(normalizeCheckoutPhone("01-234-5678")).toBe("012345678");
  });

  it("rejects invalid lengths", () => {
    expect(normalizeCheckoutPhone("1234")).toBeNull();
    expect(normalizeCheckoutPhone("12345678901")).toBeNull();
    expect(normalizeCheckoutPhone("abc")).toBeNull();
  });

  it("keeps strict mobile normalization unchanged", () => {
    expect(normalizeMyanmarPhone("09440226433")).toBe("+959440226433");
    expect(normalizeMyanmarPhone("12345")).toBeNull();
  });
});

describe("formatCheckoutPhoneDisplay", () => {
  it("formats mobile and leaves local numbers plain", () => {
    expect(formatCheckoutPhoneDisplay("+959440226433")).toContain("+95");
    expect(formatCheckoutPhoneDisplay("1234567")).toBe("1234567");
  });
});
