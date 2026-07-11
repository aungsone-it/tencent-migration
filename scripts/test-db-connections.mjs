#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const sourceUrl = process.env.SOURCE_POSTGRES_URL || "";
const targetUrl = process.env.TENCENT_DATABASE_URL || "";
const connectTimeout = process.env.PGCONNECT_TIMEOUT || "10";

function withTimeout(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connect_timeout=${connectTimeout}`;
}

function check(label, url, sql) {
  if (!url) {
    console.error(`✗ ${label}: not set in .env`);
    return false;
  }
  const host = url.replace(/^postgresql:\/\/[^@]+@([^/?]+).*/, "$1");
  console.log(`\n==> ${label}`);
  console.log(`    host: ${host}`);
  const result = spawnSync("psql", [withTimeout(url), "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, PGCONNECT_TIMEOUT: connectTimeout },
    timeout: (Number(connectTimeout) + 5) * 1000,
  });
  if (result.status === 0) {
    console.log(result.stdout.trim());
    console.log("✓ OK");
    return true;
  }
  const err = (result.stderr || result.error?.message || `exit ${result.status}`).trim();
  console.error(err);
  console.error("✗ FAILED");
  return false;
}

console.log("Testing DB connections from .env");
console.log("(Do NOT use psql $SOURCE_POSTGRES_URL in shell — .env is not auto-exported)\n");

const okSource = check(
  "Supabase (SOURCE_POSTGRES_URL)",
  sourceUrl,
  "select count(*) as app_vendors from app_vendors",
);
const okTarget = check("TencentDB (TENCENT_DATABASE_URL)", targetUrl, "select 1 as connected");

if (!okSource) {
  console.log("\nSupabase fix:");
  console.log("- Use session pooler URL (IPv4), not db.*.supabase.co direct host");
  console.log("- Supabase → Settings → Database → Connection string → Session pooler → port 5432");
}

if (!okTarget) {
  console.log("\nTencent fix:");
  console.log("- 10.0.0.10 is a PRIVATE VPC IP — your laptop cannot reach it");
  console.log("- Tencent console → TencentDB → your instance → Connection info → PUBLIC address");
  console.log("- Add your laptop IP to the security group inbound rules (TCP 5432)");
  console.log("- Or run migration from a VM inside the same VPC");
}

if (!okSource || !okTarget) {
  console.log("\nUpdate .env then re-run: npm run test:db");
  process.exit(1);
}

console.log("\nBoth connections OK. Run: npm run import:supabase-data");
