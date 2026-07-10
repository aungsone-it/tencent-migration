import { resolveCloudBaseMediaUrl } from "../../../utils/tencent/storageMediaUrl";

export interface ProductSpecificationRow {
  label: string;
  value: string;
}

export function normalizeProductSpecifications(raw: unknown): ProductSpecificationRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ProductSpecificationRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label ?? row.name ?? "").trim();
    const value = String(row.value ?? "").trim();
    if (!label) continue;
    rows.push({ label, value });
  }
  return rows;
}

/** Resolve description inline image src for storefront display. */
export function resolveDescriptionImageSrc(src: string): string {
  const trimmed = String(src || "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("data:")) return trimmed;
  return resolveCloudBaseMediaUrl(trimmed);
}

/** Rewrite <img src="..."> in product description HTML so storage paths load in the browser. */
export function rewriteDescriptionHtmlImages(html: string): string {
  if (!html || !html.includes("<img")) return html;
  return html.replace(
    /(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi,
    (_match, prefix: string, quote: string, src: string) =>
      `${prefix}${quote}${resolveDescriptionImageSrc(src)}${quote}`
  );
}
