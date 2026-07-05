import { cloudbaseApiBaseUrl } from "./cloudbase";

const FN = "make-server-16010b6f";

/** Strip duplicated `/make-server-16010b6f/make-server-16010b6f/` (misconfigured API base → 404). */
function dedupeFunctionPrefix(url: string): string {
  return url.replace(
    new RegExp(`/${FN}/${FN}/`, "g"),
    `/${FN}/`,
  );
}

/**
 * Turn KV storage signed paths into absolute URLs the browser can load.
 * Server may return `/make-server-16010b6f/storage/object?...` when
 * CLOUDBASE_API_PUBLIC_BASE_URL is unset on the Cloud Function.
 */
export function resolveCloudBaseMediaUrl(src: string): string {
  const s = dedupeFunctionPrefix(String(src || "").trim());
  if (!s || s.startsWith("data:")) return s;
  if (/^https?:\/\//i.test(s)) return dedupeFunctionPrefix(s);

  const apiBase = cloudbaseApiBaseUrl.replace(/\/+$/, "");

  if (s.startsWith(`/${FN}`)) {
    const rest = s.slice(`/${FN}`.length);
    if (/^https?:\/\//i.test(apiBase)) {
      return dedupeFunctionPrefix(`${apiBase}${rest}`);
    }
    const prefix = apiBase.startsWith("/") ? apiBase : `/${apiBase}`;
    const path = `${prefix}${rest}`.replace(/([^:]\/)\/+/g, "$1");
    if (typeof window !== "undefined") {
      return dedupeFunctionPrefix(`${window.location.origin}${path}`);
    }
    return dedupeFunctionPrefix(path);
  }

  if (s.startsWith("/api/make-server-16010b6f") && typeof window !== "undefined") {
    return dedupeFunctionPrefix(`${window.location.origin}${s}`);
  }

  return s;
}
