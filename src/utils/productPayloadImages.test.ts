import { describe, expect, it } from "vitest";
import {
  applyUploadedProductImageMap,
  collectUniqueInlineProductImages,
} from "./productPayloadImages";

const red = "data:image/png;base64,aaa";
const blue = "data:image/jpeg;base64,bbb";
const hosted = "https://cdn.example/red.png";

describe("productPayloadImages", () => {
  it("uploads 15 unique color photos once even when reused across 5 sizes", () => {
    const colors = Array.from({ length: 15 }, (_, i) => `data:image/png;base64,color${i}`);
    const images = colors;
    const variants = colors.flatMap((image, colorIdx) =>
      ["S", "M", "L", "XL", "XXL"].map((size) => ({
        option1: size,
        option2: `C${colorIdx}`,
        image,
      }))
    );

    expect(variants).toHaveLength(75);
    expect(collectUniqueInlineProductImages(images, variants)).toHaveLength(15);
  });

  it("remaps gallery and variant images to the same stored URL", () => {
    const urlMap = new Map([
      [red, "https://cdn.example/red-stored.png"],
      [blue, "https://cdn.example/blue-stored.png"],
    ]);
    const result = applyUploadedProductImageMap(
      [red, blue, hosted],
      [
        { sku: "S-RED", image: red },
        { sku: "M-RED", image: red },
        { sku: "S-BLUE", image: blue },
        { sku: "S-HOSTED", image: hosted },
      ],
      urlMap
    );

    expect(result.images).toEqual([
      "https://cdn.example/red-stored.png",
      "https://cdn.example/blue-stored.png",
      hosted,
    ]);
    expect(result.variants.map((v) => v.image)).toEqual([
      "https://cdn.example/red-stored.png",
      "https://cdn.example/red-stored.png",
      "https://cdn.example/blue-stored.png",
      hosted,
    ]);
  });
});
