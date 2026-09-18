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
  rename: { optionIndex: number; from: string; to: string }
): ProductFormVariant[] {
  return variants.map((variant) => {
    const values = [variant.option1, variant.option2, variant.option3];
    if (values[rename.optionIndex] !== rename.from) return variant;
    values[rename.optionIndex] = rename.to;
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

export function inferImageForCombo(
  combo: string[],
  previous: ProductFormVariant[],
  optionValueCounts: number[]
): string | undefined {
  const rankedIndexes = combo
    .map((_, index) => index)
    .sort((a, b) => (optionValueCounts[b] || 0) - (optionValueCounts[a] || 0));

  for (const index of rankedIndexes) {
    const value = combo[index];
    const match = previous.find((variant) => {
      const values = [variant.option1, variant.option2, variant.option3];
      return values[index] === value && Boolean(variant.image?.trim());
    });
    if (match?.image?.trim()) return match.image;
  }
  return undefined;
}

export function generateProductFormVariants(args: {
  options: ProductFormVariantOption[];
  previous: ProductFormVariant[];
  previousOptions?: ProductFormVariantOption[];
}): ProductFormVariant[] {
  const { options, previous, previousOptions } = args;

  const rename = detectOptionValueRename(previousOptions, options);
  const remappedPrevious = rename
    ? remapRenamedOptionValue(previous, rename)
    : previous;

  const combos = cartesianOptionValues(options);
  const sanitized = sanitizeVariantOptions(options);
  const optionValueCounts = sanitized.map((opt) => opt.values.length);
  const byKey = new Map(
    remappedPrevious.map((variant) => [variantComboKey(comboFromVariant(variant)), variant])
  );

  return combos.map((combo) => {
    const existing = byKey.get(variantComboKey(combo));
    if (existing) {
      return {
        ...existing,
        option1: combo[0] || "",
        option2: combo[1],
        option3: combo[2],
        image: existing.image?.trim()
          ? existing.image
          : inferImageForCombo(combo, remappedPrevious, optionValueCounts),
      };
    }

    return {
      id: stableVariantId(combo),
      option1: combo[0] || "",
      option2: combo[1],
      option3: combo[2],
      price: "",
      sku: "",
      inventory: 0,
      weight: "",
      image: inferImageForCombo(combo, remappedPrevious, optionValueCounts),
    };
  });
}

export function applyImageToOptionValue<T extends ProductFormVariant>(
  variants: T[],
  optionIndex: number,
  optionValue: string,
  image: string
): T[] {
  return variants.map((variant) => {
    const values = [variant.option1, variant.option2, variant.option3];
    if (values[optionIndex] !== optionValue) return variant;
    return { ...variant, image };
  });
}

export function dominantOptionIndex(options: ProductFormVariantOption[]): number {
  const sanitized = sanitizeVariantOptions(options);
  let best = 0;
  let bestCount = -1;
  sanitized.forEach((opt, index) => {
    if (opt.values.length > bestCount) {
      bestCount = opt.values.length;
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
