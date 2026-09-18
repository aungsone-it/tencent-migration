import { describe, expect, it } from "vitest";
import {
  applyImageToOptionValue,
  cartesianOptionValues,
  detectOptionValueRename,
  findDuplicateVariantSkus,
  generateProductFormVariants,
  inferImageForCombo,
} from "./productFormVariants";

const sizes = ["S", "M", "L", "XL", "XXL"];
const colors = [
  "Red",
  "Blue",
  "Green",
  "Black",
  "White",
  "Yellow",
  "Pink",
  "Purple",
  "Orange",
  "Grey",
  "Brown",
  "Navy",
  "Beige",
  "Maroon",
  "Teal",
];

const twoAxisOptions = [
  { name: "Size", values: sizes },
  { name: "Color", values: colors },
];

describe("productFormVariants", () => {
  it("builds 75 unique combinations for 5 sizes × 15 colors", () => {
    const combos = cartesianOptionValues(twoAxisOptions);
    expect(combos).toHaveLength(75);
    expect(new Set(combos.map((c) => c.join("/"))).size).toBe(75);
    expect(combos[0]).toEqual(["S", "Red"]);
    expect(combos[14]).toEqual(["S", "Teal"]);
    expect(combos[15]).toEqual(["M", "Red"]);
  });

  it("leaves new variant SKUs empty", () => {
    const variants = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
    });
    expect(variants).toHaveLength(75);
    expect(variants.every((v) => v.sku === "")).toBe(true);
  });

  it("preserves SKUs and images when a 16th color is added", () => {
    const previous = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
    }).map((variant) => ({
      ...variant,
      sku: `${variant.option1}-${variant.option2}`,
      image: variant.option2 === "Red" ? "red.png" : variant.image,
    }));

    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: sizes },
        { name: "Color", values: [...colors, "Ivory"] },
      ],
      previous,
      previousOptions: twoAxisOptions,
    });

    expect(next).toHaveLength(80);
    const kept = next.find((v) => v.option1 === "M" && v.option2 === "Red");
    expect(kept?.sku).toBe("M-Red");
    expect(kept?.image).toBe("red.png");
    expect(next.find((v) => v.option1 === "M" && v.option2 === "Ivory")?.sku).toBe("");
  });

  it("keeps SKUs when a color is renamed", () => {
    const previous = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
    }).map((variant) => ({
      ...variant,
      sku: `${variant.option1}-${variant.option2}`,
    }));
    const redSku = previous.find((v) => v.option1 === "S" && v.option2 === "Red")?.sku;

    const renamedColors = colors.map((c) => (c === "Red" ? "Crimson" : c));
    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: sizes },
        { name: "Color", values: renamedColors },
      ],
      previous,
      previousOptions: twoAxisOptions,
    });

    expect(detectOptionValueRename(twoAxisOptions, [
      { name: "Size", values: sizes },
      { name: "Color", values: renamedColors },
    ])).toEqual({ optionIndex: 1, from: "Red", to: "Crimson" });
    expect(next.find((v) => v.option1 === "S" && v.option2 === "Crimson")?.sku).toBe(redSku);
    expect(next.some((v) => v.option2 === "Red")).toBe(false);
  });

  it("copies a color image onto newly added sizes", () => {
    const previous = [
      {
        id: "variant-S__Red",
        option1: "S",
        option2: "Red",
        price: "",
        sku: "CUSTOM-S-RED",
        inventory: 0,
        image: "red.png",
      },
    ];
    expect(
      inferImageForCombo(["XL", "Red"], previous, [5, 15])
    ).toBe("red.png");

    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: ["S", "XL"] },
        { name: "Color", values: ["Red"] },
      ],
      previous,
    });
    expect(next.find((v) => v.option1 === "XL" && v.option2 === "Red")?.image).toBe(
      "red.png"
    );
    expect(next.find((v) => v.option1 === "XL" && v.option2 === "Red")?.sku).toBe("");
    expect(next.find((v) => v.option1 === "S" && v.option2 === "Red")?.sku).toBe(
      "CUSTOM-S-RED"
    );
  });

  it("applies one color image across every size", () => {
    const variants = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
    });
    const updated = applyImageToOptionValue(variants, 1, "Navy", "navy.png");
    const navy = updated.filter((v) => v.option2 === "Navy");
    expect(navy).toHaveLength(5);
    expect(navy.every((v) => v.image === "navy.png")).toBe(true);
    expect(updated.filter((v) => v.option2 === "Red" && v.image).length).toBe(0);
  });

  it("flags duplicate SKUs inside the product", () => {
    const dupes = findDuplicateVariantSkus([
      { id: "a", sku: "TEE-S-RED" },
      { id: "b", sku: "tee-s-red" },
      { id: "c", sku: "TEE-M-RED" },
    ]);
    expect(dupes.get("a")).toContain("Duplicate SKU");
    expect(dupes.get("b")).toContain("Duplicate SKU");
    expect(dupes.has("c")).toBe(false);
  });
});
