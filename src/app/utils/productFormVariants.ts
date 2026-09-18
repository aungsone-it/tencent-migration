export type ProductFormVariant = {
  id: string;
  option1: string;
  option2?: string;
  option3?: string;
  price: string;
  compareAtPrice?: string;
  sku: string;
  barcode?: string;
  inventory: number;
  weight?: string;
  image?: string;
};

export type ProductFormVariantOption = { name: string; values: string[] };

export const LIVE_VARIANT_SKU_CHECK_LIMIT = 10;

export function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function sanitizeVariantOptions(
  options: ProductFormVariantOption[]
): ProductFormVariantOption[] {
  return options
    .map((opt, index) => ({
      name: opt.name.trim() || `Option ${index + 1}`,
      values: uniquePreserveOrder(opt.values.map((v) => v.trim()).filter(Boolean)),
    }))
    .filter((opt) => opt.values.length > 0);
}

export function variantComboKey(combo: Array<string | undefined>): string {
  return combo.map((v) => String(v ?? "").trim()).join("\u0000");
}

export function stableVariantId(combo: string[]): string {
  return `variant-${combo.map((v) => encodeURIComponent(v.trim())).join("__")}`;
}

export function cartesianOptionValues(options: ProductFormVariantOption[]): string[][] {
  const cleaned = sanitizeVariantOptions(options);
  if (cleaned.length === 0) return [];

  return cleaned.reduce<string[][]>((acc, opt) => {
    if (acc.length === 0) return opt.values.map((value) => [value]);
    const next: string[][] = [];
    for (const prefix of acc) {
      for (const value of opt.values) {
        next.push([...prefix, value]);
      }
    }
    return next;
  }, []);
}

/** UI option index → variant option1/2/3 slot, skipping empty options. */
export function variantOptionSlotIndex(
  options: ProductFormVariantOption[],
  uiIndex: number
): number {
  if (!options[uiIndex]?.values.some((value) => value.trim() !== "")) return -1;
  let slot = -1;
  for (let i = 0; i <= uiIndex; i++) {
    if (options[i]?.values.some((value) => value.trim() !== "")) slot += 1;
  }
  return slot;
}

export function optionValueImageKey(uiIndex: number, value: string): string {
  return `${uiIndex}::${value.trim().toLowerCase()}`;
}

export function visualOptionIndex(options: ProductFormVariantOption[]): number {
  const named = options.findIndex((opt) => {
    if (!opt.values.some((value) => value.trim() !== "")) return false;
    return /color|colour|style|pattern/i.test(opt.name);
  });
  if (named >= 0) return named;
  return dominantOptionIndex(options);
}

export function sharedImageForOptionValue(
  variants: ProductFormVariant[],
  slot: number,
  value: string
): string {
  const want = value.trim().toLowerCase();
  if (!want || slot < 0) return "";
  const images = variants
    .filter((variant) => {
      const got = [variant.option1, variant.option2, variant.option3][slot];
      return String(got ?? "").trim().toLowerCase() === want;
    })
    .map((variant) => String(variant.image ?? "").trim())
    .filter(Boolean);
  if (images.length === 0) return "";
  return images.every((image) => image === images[0]) ? images[0] : "";
}

export function optionValueImagesFromVariants(
  options: ProductFormVariantOption[],
  variants: ProductFormVariant[]
): Record<string, string> {
  const out: Record<string, string> = {};
  options.forEach((opt, uiIndex) => {
    const slot = variantOptionSlotIndex(options, uiIndex);
    if (slot < 0) return;
    for (const value of opt.values) {
      const shared = sharedImageForOptionValue(variants, slot, value);
      if (shared) out[optionValueImageKey(uiIndex, value)] = shared;
    }
  });
  return out;
}

function remapOptionValueImagesOnRename(
  images: Record<string, string> | undefined,
  rename: { optionIndex: number; from: string; to: string } | null
): Record<string, string> {
  if (!images) return {};
  if (!rename) return { ...images };
  const fromKey = optionValueImageKey(rename.optionIndex, rename.from);
  const toKey = optionValueImageKey(rename.optionIndex, rename.to);
  if (!(fromKey in images) || fromKey === toKey) return { ...images };
  const next = { ...images };
  if (!next[toKey]) next[toKey] = next[fromKey];
  delete next[fromKey];
  return next;
}

export function detectOptionValueRename(
  previous: ProductFormVariantOption[] | undefined,
  next: ProductFormVariantOption[]
): { optionIndex: number; from: string; to: string } | null {
  if (!previous || previous.length !== next.length) return null;

  const renames: { optionIndex: number; from: string; to: string }[] = [];
  for (let optionIndex = 0; optionIndex < next.length; optionIndex++) {
    const fromValues = previous[optionIndex]?.values ?? [];
    const toValues = next[optionIndex]?.values ?? [];
    if (fromValues.length !== toValues.length) continue;

    const diffs: { from: string; to: string }[] = [];
    for (let valueIndex = 0; valueIndex < toValues.length; valueIndex++) {
      if (fromValues[valueIndex] === toValues[valueIndex]) continue;
      if (!toValues[valueIndex].trim()) continue;
      diffs.push({ from: fromValues[valueIndex], to: toValues[valueIndex] });
    }
    if (diffs.length === 1 && diffs[0].from.trim() !== "") {
      renames.push({ optionIndex, from: diffs[0].from, to: diffs[0].to });
    }
  }

  return renames.length === 1 ? renames[0] : null;
}

function comboFromVariant(variant: ProductFormVariant): string[] {
  return [variant.option1, variant.option2, variant.option3]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
}

function remapRenamedOptionValue(
  variants: ProductFormVariant[],
  rename: { optionIndex: number; from: string; to: string },
  options: ProductFormVariantOption[]
): ProductFormVariant[] {
  const slot = variantOptionSlotIndex(options, rename.optionIndex);
  if (slot < 0) return variants;
  const from = rename.from.trim();
  return variants.map((variant) => {
    const values = [variant.option1, variant.option2, variant.option3];
    if (String(values[slot] ?? "").trim() !== from) return variant;
    values[slot] = rename.to.trim();
    const combo = values.map((v) => String(v ?? "").trim()).filter(Boolean);
    return {
      ...variant,
      option1: values[0] || "",
      option2: values[1],
      option3: values[2],
      id: variant.id || stableVariantId(combo),
    };
  });
}

/** Copy an image only from the same visual option (usually color), never from size. */
export function inferImageForCombo(
  combo: string[],
  previous: ProductFormVariant[],
  preferredSlot: number
): string | undefined {
  const value = String(combo[preferredSlot] ?? "").trim();
  if (!value || preferredSlot < 0) return undefined;
  const match = previous.find((variant) => {
    const values = [variant.option1, variant.option2, variant.option3];
    return (
      String(values[preferredSlot] ?? "").trim().toLowerCase() === value.toLowerCase() &&
      Boolean(variant.image?.trim())
    );
  });
  return match?.image?.trim() || undefined;
}

function numericPrice(value: unknown): number {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function isInheritedVariantPrice(
  variantPrice: string | undefined,
  previousDefaultPrice: string | undefined
): boolean {
  const current = numericPrice(variantPrice);
  if (current <= 0) return true;
  const previousDefault = numericPrice(previousDefaultPrice);
  return previousDefault > 0 && current === previousDefault;
}

function imageFromOptionValueMap(
  combo: string[],
  options: ProductFormVariantOption[],
  optionValueImages: Record<string, string>
): string | undefined {
  const visualUi = visualOptionIndex(options);
  const visualSlot = variantOptionSlotIndex(options, visualUi);
  const lookup = (uiIndex: number, slot: number) => {
    const value = combo[slot];
    if (value == null || value === "") return "";
    return optionValueImages[optionValueImageKey(uiIndex, value)] || "";
  };
  if (visualSlot >= 0) {
    const preferred = lookup(visualUi, visualSlot);
    if (preferred) return preferred;
  }
  for (let uiIndex = 0; uiIndex < options.length; uiIndex++) {
    const slot = variantOptionSlotIndex(options, uiIndex);
    if (slot < 0) continue;
    const url = lookup(uiIndex, slot);
    if (url) return url;
  }
  return undefined;
}

export function generateProductFormVariants(args: {
  options: ProductFormVariantOption[];
  previous: ProductFormVariant[];
  previousOptions?: ProductFormVariantOption[];
  optionValueImages?: Record<string, string>;
  defaultPrice?: string;
  previousDefaultPrice?: string;
}): ProductFormVariant[] {
  const { options, previous, previousOptions, optionValueImages, defaultPrice = "", previousDefaultPrice = "" } =
    args;

  const rename = detectOptionValueRename(previousOptions, options);
  const remapOptions = previousOptions && previousOptions.length > 0 ? previousOptions : options;
  const remappedPrevious = rename
    ? remapRenamedOptionValue(previous, rename, remapOptions)
    : previous;
  const imagesByValue = remapOptionValueImagesOnRename(optionValueImages, rename);

  const combos = cartesianOptionValues(options);
  const visualSlot = variantOptionSlotIndex(options, visualOptionIndex(options));
  const byKey = new Map(
    remappedPrevious.map((variant) => [variantComboKey(comboFromVariant(variant)), variant])
  );

  return combos.map((combo) => {
    const existing = byKey.get(variantComboKey(combo));
    const mappedImage = imageFromOptionValueMap(combo, options, imagesByValue);
    const inferredImage = inferImageForCombo(combo, remappedPrevious, visualSlot);
    if (existing) {
      return {
        ...existing,
        option1: combo[0] || "",
        option2: combo[1],
        option3: combo[2],
        price: isInheritedVariantPrice(existing.price, previousDefaultPrice)
          ? defaultPrice
          : existing.price,
        image: mappedImage || existing.image?.trim() || inferredImage,
      };
    }

    return {
      id: stableVariantId(combo),
      option1: combo[0] || "",
      option2: combo[1],
      option3: combo[2],
      price: defaultPrice,
      sku: "",
      inventory: 0,
      weight: "",
      image: mappedImage || inferredImage,
    };
  });
}

export function applyImageToOptionValue<T extends ProductFormVariant>(
  variants: T[],
  optionIndex: number,
  optionValue: string,
  image: string
): T[] {
  const want = optionValue.trim().toLowerCase();
  if (!want || optionIndex < 0) return variants;
  return variants.map((variant) => {
    const values = [variant.option1, variant.option2, variant.option3];
    if (String(values[optionIndex] ?? "").trim().toLowerCase() !== want) return variant;
    return { ...variant, image };
  });
}

export function dominantOptionIndex(options: ProductFormVariantOption[]): number {
  let best = 0;
  let bestCount = -1;
  options.forEach((opt, index) => {
    const count = uniquePreserveOrder(opt.values.map((value) => value.trim()).filter(Boolean)).length;
    if (count > bestCount) {
      bestCount = count;
      best = index;
    }
  });
  return best;
}

export function findDuplicateVariantSkus(
  variantRows: Array<{ id: string; sku?: string }>
): Map<string, string> {
  const seen = new Map<string, string>();
  const duplicates = new Map<string, string>();
  for (const variant of variantRows) {
    const sku = String(variant.sku || "").trim();
    if (!sku) continue;
    const key = sku.toLowerCase();
    const firstVariantId = seen.get(key);
    if (firstVariantId) {
      duplicates.set(firstVariantId, `Duplicate SKU "${sku}" in this product`);
      duplicates.set(variant.id, `Duplicate SKU "${sku}" in this product`);
      continue;
    }
    seen.set(key, variant.id);
  }
  return duplicates;
}
