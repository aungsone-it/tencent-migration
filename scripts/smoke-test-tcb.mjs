#!/usr/bin/env node
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const apiBaseUrl = (
  process.env.CLOUDBASE_API_BASE_URL ||
  process.env.VITE_CLOUDBASE_API_BASE_URL ||
  process.env.TENCENT_API_BASE_URL ||
  ""
).replace(/\/+$/, "");

const publishableKey =
  process.env.CLOUDBASE_PUBLISHABLE_KEY ||
  process.env.VITE_CLOUDBASE_PUBLISHABLE_KEY ||
  process.env.TCB_PUBLISHABLE_KEY ||
  "";

const envId = process.env.VITE_CLOUDBASE_ENV_ID || process.env.CLOUDBASE_ENV_ID || "";
const vendorDomain = process.env.VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN || "";

if (!apiBaseUrl) {
  console.error("Missing API base URL. Set VITE_CLOUDBASE_API_BASE_URL in .env");
  process.exit(2);
}

const checks = [];

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true, result });
    console.log(`PASS  ${name}`);
    if (result?.detail) console.log(`      ${result.detail}`);
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL  ${name}: ${checks.at(-1).error}`);
  }
}

await check("health endpoint", async () => {
  const res = await fetch(`${apiBaseUrl}/health`, {
    headers: {
      ...(publishableKey ? { Authorization: `Bearer ${publishableKey}` } : {}),
    },
  });
  const text = await res.text();
  if (res.status === 403 && text.includes("EXCEED_AUTHORITY")) {
    throw new Error(
      "403 EXCEED_AUTHORITY — deploy make-server-16010b6f in TCB console and enable HTTP API invoke permission for your publishable key (Access Control -> Policy Management).",
    );
  }
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (String(body.status || "").toLowerCase() !== "ok") {
    throw new Error(`Unexpected health payload: ${text}`);
  }
  return { detail: `status=${body.status}` };
});

await check("frontend env sanity", async () => {
  const missing = [];
  if (!envId) missing.push("VITE_CLOUDBASE_ENV_ID");
  if (!publishableKey) missing.push("VITE_CLOUDBASE_PUBLISHABLE_KEY");
  if (!vendorDomain) missing.push("VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN");
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  return { detail: `env=${envId}, apex=${vendorDomain}` };
});

const failed = checks.filter((item) => !item.ok);
console.log(`\nSmoke test: ${checks.length - failed.length}/${checks.length} passed`);

if (failed.length) {
  console.error("\nFix the failed checks before relying on production traffic.");
  console.error("See docs/TCB_CONSOLE_SETUP.md for HTTP Gateway and function env setup.");
  process.exit(1);
}

console.log("\nTCB smoke checks passed. Next: create test vendor/product in the empty DB.");
