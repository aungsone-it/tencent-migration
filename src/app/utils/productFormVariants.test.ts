import { describe, expect, it } from "vitest";
import {
  applyImageToOptionValue,
  buildAutoSku,
  cartesianOptionValues,
  detectOptionValueRename,
  fillEmptyVariantSkus,
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

  it("auto-builds SKUs from prefix + size + color", () => {
    expect(buildAutoSku("SHIRT", ["S", "Red"])).toBe("SHIRT-S-RED");
    expect(buildAutoSku("", ["Navy Blue", "XXL"])).toBe("NAVY-BLUE-XXL");
  });

  it("preserves SKUs and images when a 16th color is added", () => {
    const previous = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
      skuPrefix: "TEE",
    }).map((variant) =>
      variant.option2 === "Red" ? { ...variant, image: "red.png" } : variant
    );

    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: sizes },
        { name: "Color", values: [...colors, "Ivory"] },
      ],
      previous,
      previousOptions: twoAxisOptions,
      skuPrefix: "TEE",
    });

    expect(next).toHaveLength(80);
    const kept = next.find((v) => v.option1 === "M" && v.option2 === "Red");
    expect(kept?.sku).toBe("TEE-M-RED");
    expect(kept?.image).toBe("red.png");
    expect(next.find((v) => v.option1 === "M" && v.option2 === "Ivory")?.sku).toBe(
      "TEE-M-IVORY"
    );
  });

  it("keeps SKUs when a color is renamed", () => {
    const previous = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
      skuPrefix: "TEE",
    });
    const redSku = previous.find((v) => v.option1 === "S" && v.option2 === "Red")?.sku;

    const renamedColors = colors.map((c) => (c === "Red" ? "Crimson" : c));
    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: sizes },
        { name: "Color", values: renamedColors },
      ],
      previous,
      previousOptions: twoAxisOptions,
      skuPrefix: "TEE",
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
        sku: "TEE-S-RED",
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
      skuPrefix: "TEE",
    });
    expect(next.find((v) => v.option1 === "XL" && v.option2 === "Red")?.image).toBe(
      "red.png"
    );
  });

  it("applies one color image across every size", () => {
    const variants = generateProductFormVariants({
      options: twoAxisOptions,
      previous: [],
      skuPrefix: "TEE",
    });
    const updated = applyImageToOptionValue(variants, 1, "Navy", "navy.png");
    const navy = updated.filter((v) => v.option2 === "Navy");
    expect(navy).toHaveLength(5);
    expect(navy.every((v) => v.image === "navy.png")).toBe(true);
    expect(updated.filter((v) => v.option2 === "Red" && v.image).length).toBe(0);
  });

  it("fills only empty SKUs from the prefix", () => {
    const filled = fillEmptyVariantSkus(
      [
        {
          id: "1",
          option1: "S",
          option2: "Red",
          price: "",
          sku: "CUSTOM",
          inventory: 0,
        },
        {
          id: "2",
          option1: "M",
          option2: "Red",
          price: "",
          sku: "",
          inventory: 0,
        },
      ],
      "TEE"
    );
    expect(filled[0].sku).toBe("CUSTOM");
    expect(filled[1].sku).toBe("TEE-M-RED");
  });

  it("updates generated SKUs when the prefix is added later", () => {
    const previous = generateProductFormVariants({
      options: [
        { name: "Size", values: ["S"] },
        { name: "Color", values: ["Red"] },
      ],
      previous: [],
      skuPrefix: "",
    });
    expect(previous[0].sku).toBe("S-RED");

    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: ["S"] },
        { name: "Color", values: ["Red"] },
      ],
      previous,
      previousSkuPrefix: "",
      skuPrefix: "TEE",
    });
    expect(next[0].sku).toBe("TEE-S-RED");
  });

  it("does not overwrite a custom SKU when the prefix changes", () => {
    const next = generateProductFormVariants({
      options: [
        { name: "Size", values: ["S"] },
        { name: "Color", values: ["Red"] },
      ],
      previous: [
        {
          id: "1",
          option1: "S",
          option2: "Red",
          price: "",
          sku: "CUSTOM-001",
          inventory: 0,
        },
      ],
      previousSkuPrefix: "",
      skuPrefix: "TEE",
    });
    expect(next[0].sku).toBe("CUSTOM-001");
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
