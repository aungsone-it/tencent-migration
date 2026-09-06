/**
 * Resolve storefront slugs / names (`go-go`, `gogo`, `go go`) to the canonical vendor id.
 */
import * as kv from "./kv_store.tsx";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Distinct KV lookup keys for a vendor id, URL slug, or store name. */
export function vendorSlugLookupCandidates(raw: string): string[] {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  const hyphenated = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const out: string[] = [];
  for (const candidate of [trimmed, lower, hyphenated, compact]) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

export function compactVendorKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export async function resolveCanonicalVendorId(vendorIdOrSlug: string): Promise<string> {
  const raw = text(vendorIdOrSlug);
  if (!raw) return "";

  const lookup = async (candidate: string): Promise<string> => {
    const slugRow = (await kv.get(`vendor_slug_${candidate}`).catch(() => null)) as
      | { vendorId?: unknown }
      | null;
    const fromSlug = text(slugRow?.vendorId);
    if (fromSlug) return fromSlug;

    const direct = (await kv.get(`vendor:${candidate}`).catch(() => null)) as { id?: unknown } | null;
    const fromDirect = text(direct?.id);
    if (fromDirect) return fromDirect;
    return "";
  };

  for (const candidate of vendorSlugLookupCandidates(raw)) {
    const found = await lookup(candidate);
    if (found) return found;
  }

  const compact = compactVendorKey(raw);
  if (compact && compact !== raw.toLowerCase()) {
    try {
      const rows = await kv.getByPrefixWithKeys("vendor_slug_");
      for (const row of rows) {
        const slug = String(row.key || "").replace(/^vendor_slug_/, "");
        if (compactVendorKey(slug) !== compact) continue;
        const vid = text((row.value as { vendorId?: unknown } | null)?.vendorId);
        if (vid) return vid;
      }
    } catch {
      /* ignore scan failure — caller keeps the raw token */
    }
  }

  return raw;
}
