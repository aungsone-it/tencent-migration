import { cloudbaseApiBaseUrl } from "./cloudbase";

/**
 * Turn KV storage signed paths into absolute URLs the browser can load.
 * Server may return `/make-server-16010b6f/storage/object?...` when
 * CLOUDBASE_API_PUBLIC_BASE_URL is unset on the Cloud Function.
 */
export function resolveCloudBaseMediaUrl(src: string): string {
  const s = String(src || "").trim();
  if (!s || s.startsWith("data:") || /^https?:\/\//i.test(s)) return s;

  const apiBase = cloudbaseApiBaseUrl.replace(/\/+$/, "");

  if (s.startsWith("/make-server-16010b6f")) {
    const rest = s.slice("/make-server-16010b6f".length);
    if (/^https?:\/\//i.test(apiBase)) {
      return `${apiBase}${rest}`;
    }
    const prefix = apiBase.startsWith("/") ? apiBase : `/${apiBase}`;
    const path = `${prefix}${rest}`.replace(/([^:]\/)\/+/g, "$1");
    if (typeof window !== "undefined") {
      return `${window.location.origin}${path}`;
    }
    return path;
  }

  if (s.startsWith("/api/make-server-16010b6f") && typeof window !== "undefined") {
    return `${window.location.origin}${s}`;
  }

  return s;
}
