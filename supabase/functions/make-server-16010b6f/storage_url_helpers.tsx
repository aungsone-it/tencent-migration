/**
 * Resolve stored image refs (paths, relative signed URLs) to absolute client URLs.
 */
import type { CloudBaseCompatClient } from "./cloudbase_compat.ts";
import { parseOwnedStorageRef } from "./storage_delete_helpers.tsx";
import { publicStorageApiBaseUrl } from "./kv_storage_backend.ts";

const STORAGE_OBJECT_PREFIX = "/make-server-16010b6f/storage/object";

function apiOrigin(): string {
  const base = publicStorageApiBaseUrl().replace(/\/+$/, "");
  if (!base) return "";
  return base.replace(/\/make-server-16010b6f\/?$/, "");
}

/** Make a relative `/make-server-16010b6f/storage/object?...` URL absolute. */
export function absolutizeStorageObjectUrl(url: string): string {
  const s = String(url || "").trim();
  if (!s || /^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
  if (!s.startsWith(STORAGE_OBJECT_PREFIX)) return s;
  const origin = apiOrigin();
  return origin ? `${origin}${s}` : s;
}

/** Refresh or build a signed URL for a stored logo / profile / avatar ref. */
export async function resolveClientImageUrl(
  supabase: CloudBaseCompatClient,
  value: unknown,
  expiresIn = 315360000,
): Promise<string> {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return "";
  if (s.startsWith("data:")) return s;

  if (/^https?:\/\//i.test(s)) {
    if (s.includes("/storage/object?") || s.includes(STORAGE_OBJECT_PREFIX)) {
      try {
        const parsed = new URL(s, "https://placeholder.local");
        const bucket = parsed.searchParams.get("bucket") || "";
        const path = parsed.searchParams.get("path") || "";
        if (bucket && path) {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrl(path, expiresIn);
          if (!error && data?.signedUrl) {
            return absolutizeStorageObjectUrl(data.signedUrl);
          }
        }
      } catch {
        /* fall through */
      }
    }
    return s;
  }

  if (s.startsWith(STORAGE_OBJECT_PREFIX)) {
    return absolutizeStorageObjectUrl(s);
  }

  const ref = parseOwnedStorageRef(s);
  if (ref) {
    const { data, error } = await supabase.storage
      .from(ref.bucket)
      .createSignedUrl(ref.objectPath, expiresIn);
    if (!error && data?.signedUrl) {
      return absolutizeStorageObjectUrl(data.signedUrl);
    }
  }

  return s;
}
