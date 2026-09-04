#!/usr/bin/env node
/**
 * Reset subscription test data via deployed CloudBase API (works when laptop cannot reach TencentDB).
 *
 *   npm run db:reset-subscriptions:api -- --dry-run
 *   npm run db:reset-subscriptions:api
 *
 * Requires in .env:
 *   VITE_CLOUDBASE_API_BASE_URL
 *   VITE_ADMIN_OPERATION_SECRET (or EDGE_ADMIN_OPERATION_SECRET)
 *
 * Deploy the function first if you get 404:
 *   npm run deploy:functions
 */
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const apiBase = (
  process.env.VITE_CLOUDBASE_API_BASE_URL ||
  process.env.CLOUDBASE_API_BASE_URL ||
  ""
).replace(/\/+$/, "");
const secret =
  process.env.VITE_ADMIN_OPERATION_SECRET ||
  process.env.EDGE_ADMIN_OPERATION_SECRET ||
  "";

if (!apiBase) {
  console.error("VITE_CLOUDBASE_API_BASE_URL is not set in .env");
  console.error("Example:");
  console.error(
    "  VITE_CLOUDBASE_API_BASE_URL=https://YOUR_ENV.ap-singapore.app.tcloudbase.com/make-server-16010b6f",
  );
  process.exit(1);
}

if (!secret) {
  console.error("VITE_ADMIN_OPERATION_SECRET (or EDGE_ADMIN_OPERATION_SECRET) is not set in .env");
  process.exit(1);
}

const url = `${apiBase}/admin/reset-subscription-test-data`;
const body = dryRun ? { dryRun: true } : { confirmDelete: true };

console.log(`POST ${url}`);
if (dryRun) console.log("[dry-run] counts only — no deletes\n");

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-operation-secret": secret,
  },
  body: JSON.stringify(body),
});

const text = await response.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { raw: text };
}

if (response.status === 404) {
  console.error("404 — route not found on deployed function.");
  console.error("Deploy updated make-server-16010b6f first:");
  console.error("  npm run deploy:functions");
  console.error("\nOr reset directly against TencentDB (VPN + security group):");
  console.error("  npm run db:reset-subscriptions -- --dry-run");
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));

if (!response.ok) {
  process.exit(1);
}

if (!dryRun && data.success) {
  console.log("\n✓ Done. Clear Finances cache:");
  console.log("  localStorage.removeItem('migoo-ls-admin-finances-analytics-v1'); location.reload();");
}
