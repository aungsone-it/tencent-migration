export const PRODUCT_IMAGE_DATA_URL_RE = /^data:image\/(png|jpg|jpeg|gif|webp);base64,/i;

export function isProductImageDataUrl(src: unknown): src is string {
  return typeof src === "string" && PRODUCT_IMAGE_DATA_URL_RE.test(src);
}

/** Unique inline data URLs from gallery + variant images, first-seen order. */
export function collectUniqueInlineProductImages(
  images: unknown[] | undefined,
  variants: Array<{ image?: unknown }> | undefined
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (src: unknown) => {
    if (!isProductImageDataUrl(src) || seen.has(src)) return;
    seen.add(src);
    out.push(src);
  };
  for (const img of images || []) add(img);
  for (const variant of variants || []) add(variant?.image);
  return out;
}

export function applyUploadedProductImageMap<T extends { image?: string }>(
  images: string[] | undefined,
  variants: T[] | undefined,
  urlMap: Map<string, string>
): { images: string[]; variants: T[] } {
  const remap = (src: string) => urlMap.get(src) ?? src;
  return {
    images: (images || []).map((img) => (typeof img === "string" ? remap(img) : img)),
    variants: (variants || []).map((variant) => {
      if (typeof variant.image !== "string" || !urlMap.has(variant.image)) return variant;
      return { ...variant, image: urlMap.get(variant.image)! };
    }),
  };
}
