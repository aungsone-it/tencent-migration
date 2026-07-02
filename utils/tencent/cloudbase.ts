// Tencent CloudBase runtime configuration.
//
// Keep this module framework-light: it is imported by browser code and can also be
// consumed by edge/serverless helpers during the Supabase-to-Tencent migration.

type EnvMap = Record<string, string | undefined>;

const viteEnv: EnvMap =
  typeof import.meta !== "undefined" && (import.meta as unknown as { env?: EnvMap }).env
    ? ((import.meta as unknown as { env: EnvMap }).env)
    : {};

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = viteEnv[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const cloudbaseEnvId = envValue("VITE_CLOUDBASE_ENV_ID", "VITE_TCB_ENV_ID");
export const cloudbaseRegion = envValue("VITE_CLOUDBASE_REGION", "VITE_TCB_REGION") || "ap-shanghai";
export const cloudbasePublishableKey = envValue(
  "VITE_CLOUDBASE_PUBLISHABLE_KEY",
  "VITE_TCB_PUBLISHABLE_KEY",
);

/**
 * Public HTTP base for the migrated Hono API.
 *
 * Prefer setting VITE_CLOUDBASE_API_BASE_URL explicitly in production. The
 * same-origin fallback is useful when CloudBase Hosting rewrites /api/* to an
 * HTTP Cloud Function.
 */
export const cloudbaseApiBaseUrl = stripTrailingSlash(
  envValue("VITE_CLOUDBASE_API_BASE_URL", "VITE_TENCENT_API_BASE_URL") ||
    "/api/make-server-16010b6f",
);

export const cloudbaseWebhookBaseUrl = stripTrailingSlash(
  envValue("VITE_CLOUDBASE_WEBHOOK_BASE_URL") || cloudbaseApiBaseUrl,
);

export function getCloudBaseRequestHeaders(): Record<string, string> {
  return {
    ...(cloudbaseEnvId ? { "x-cloudbase-env-id": cloudbaseEnvId } : {}),
    ...(cloudbaseRegion ? { "x-cloudbase-region": cloudbaseRegion } : {}),
    ...(cloudbasePublishableKey
      ? { "x-cloudbase-publishable-key": cloudbasePublishableKey }
      : {}),
  };
}

// Compatibility exports for files that still import the old generated Supabase
// binding during the migration. These are Tencent values now, not Supabase
// credentials.
export const projectId = cloudbaseEnvId || "local-cloudbase";
export const publicAnonKey = cloudbasePublishableKey || cloudbaseEnvId || "cloudbase-public";
