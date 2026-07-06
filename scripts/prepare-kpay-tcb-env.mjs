#!/usr/bin/env node
/**
 * Collapse duplicate KPAY_* aliases into canonical names for TCB console paste.
 *
 * 1. Copy cloudbase/kpay-secrets.env.example → cloudbase/kpay-secrets.env
 * 2. Paste values from your vault / old .env / KBZ portal (NOT from Supabase UI)
 * 3. npm run kpay:prepare-tcb-env
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, projectRoot } from "./load-env.mjs";

const root = projectRoot();
const inputPath = path.join(root, "cloudbase", "kpay-secrets.env");

/** Canonical name → alternate Supabase names (same value). First wins if both set. */
const ALIAS_GROUPS = [
  ["KPAY_PROXY_BASE_URL", "KPAY_BASE_URL"],
  ["KPAY_APPID", "KPAY_APP_ID"],
  ["KPAY_MERCH_CODE", "KPAY_MERCHANT_ID"],
  ["KPAY_SIGN_KEY", "KPAY_SECRET"],
  ["KPAY_PATH_CREATE_QR", "KPAY_CREATE_QR_PATH"],
  ["KPAY_PATH_QUERY_ORDER", "KPAY_QUERY_ORDER_PATH"],
  ["KPAY_PATH_REFUND", "KPAY_REFUND_PATH"],
  ["KPAY_SUB_MERCH_CODE", "KPAY_SUB_MERCHANT_CODE"],
  ["KPAY_SUB_APPID", "KPAY_SUB_APP_ID"],
  ["KPAY_ISV_TRANS_TYPE", "KPAY_TRANS_TYPE"],
  ["KPAY_PWA_APPID", "KPAY_PWA_APP_ID"],
  ["KPAY_PWA_MERCH_CODE", "KPAY_PWA_MERCHANT_ID"],
  ["KPAY_PWA_SIGN_KEY", "KPAY_PWA_SECRET"],
  ["KPAY_PWA_SUB_MERCH_CODE", "KPAY_PWA_SUB_MERCHANT_CODE"],
  ["KPAY_PWA_SUB_APPID", "KPAY_PWA_SUB_APP_ID"],
  ["KPAY_PWA_ISV_TRANS_TYPE", "KPAY_PWA_TRANS_TYPE"],
];

const STANDALONE_KEYS = [
  "KPAY_NOTIFY_URL",
  "KPAY_PWA_FRONTEND_RETURN_URL",
  "KPAY_ENV",
  "KPAY_API_KEY",
  "KPAY_TIMEOUT_MS",
  "KPAY_AUTO_DISCOVER",
  "KPAY_STRICT_PROTOCOL",
  "KPAY_WRAP_REQUEST",
  "KPAY_PROXY_AUTH_HEADER",
  "KPAY_PROXY_AUTH_SCHEME",
  "KPAY_PROXY_AUTH_TOKEN",
  "KPAY_PWA_TRADE_TYPES",
  "KPAY_PWA_WRAP_REQUEST",
  "KPAY_USE_VPS_REFUND",
  "KPAY_REFUND_URL",
  "KBZ_VPS_REFUND_URL",
  "KBZ_VPS_API_SECRET",
  "KBZ_VPS_API_SECRET_HEADER",
  "KBZ_VPS_API_SECRET_SCHEME",
  "KPAY_VPS_REFUND_TIMEOUT_MS",
  "KPAY_REFUND_SUB_TYPE",
  "KPAY_REFUND_SUB_IDENTIFIER_TYPE",
  "KPAY_REFUND_SUB_IDENTIFIER",
  "KPAY_REFUND_TRANS_CURRENCY",
  "KPAY_REFUND_WRAP_REQUEST",
  "KPAY_WEBHOOK_UAT_TRUST_NOTIFY",
  "KPAY_PWA_RECONCILE_SECRET",
];

const REQUIRED = [
  "KPAY_PROXY_BASE_URL",
  "KPAY_APPID",
  "KPAY_MERCH_CODE",
  "KPAY_SIGN_KEY",
  "KPAY_NOTIFY_URL",
  "KPAY_PWA_FRONTEND_RETURN_URL",
];

function parseEnvFile(filePath) {
  const out = new Map();
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out.set(key, value);
  }
  return out;
}

function collapseAliases(raw) {
  const canonical = new Map();
  const aliasOnly = [];

  for (const group of ALIAS_GROUPS) {
    const [primary, ...aliases] = group;
    let value = "";
    for (const name of group) {
      if (raw.has(name) && raw.get(name)) {
        value = raw.get(name);
        break;
      }
    }
    if (value) canonical.set(primary, value);
    for (const alias of aliases) {
      if (raw.has(alias) && raw.get(alias) && !raw.has(primary)) {
        aliasOnly.push(alias);
      }
    }
  }

  for (const key of STANDALONE_KEYS) {
    if (raw.has(key) && raw.get(key)) canonical.set(key, raw.get(key));
  }

  // Pass through any other KPAY_/KBZ_ keys not in groups (forward compat)
  for (const [key, value] of raw) {
    if (!value) continue;
    if (canonical.has(key)) continue;
    if (/^(KPAY_|KBZ_)/.test(key)) canonical.set(key, value);
  }

  return { canonical, aliasOnly };
}

function suggestTcbUrls() {
  loadEnvFile();
  const envId = process.env.CLOUDBASE_ENV_ID || process.env.VITE_CLOUDBASE_ENV_ID || "YOUR_ENV_ID";
  const apex = process.env.VITE_VENDOR_SUBDOMAIN_BASE_DOMAIN || "walwal.online";
  return {
    notify: `https://${envId}.api.tcloudbasegateway.com/v1/functions/kpay-webhook`,
    summary: `https://${apex}/summary`,
  };
}

function formatBlock(title, entries) {
  const lines = [`# ${title}`];
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n");
}

if (!fs.existsSync(inputPath)) {
  console.error(`Missing ${path.relative(root, inputPath)}`);
  console.error("");
  console.error("Supabase dashboard only shows SHA256 digests — values cannot be copied from there.");
  console.error("");
  console.error("Do this instead:");
  console.error("  1. cp cloudbase/kpay-secrets.env.example cloudbase/kpay-secrets.env");
  console.error("  2. Fill values from password manager / old .env / KBZ portal");
  console.error("  3. npm run kpay:prepare-tcb-env");
  process.exit(1);
}

const raw = parseEnvFile(inputPath);
const { canonical } = collapseAliases(raw);
const suggested = suggestTcbUrls();

console.log(`Read ${raw.size} keys from cloudbase/kpay-secrets.env`);
console.log(`Collapsed to ${canonical.size} canonical TCB variables\n`);

const missing = REQUIRED.filter((k) => !canonical.has(k));
if (missing.length) {
  console.log("Missing required (fill in kpay-secrets.env):");
  for (const key of missing) console.log(`  - ${key}`);
  console.log("");
}

const notify = canonical.get("KPAY_NOTIFY_URL") || "";
const summary = canonical.get("KPAY_PWA_FRONTEND_RETURN_URL") || "";
if (notify.includes("supabase.co") || notify.includes("supabase.in")) {
  console.log("WARN  KPAY_NOTIFY_URL still looks like Supabase — use TCB kpay-webhook URL:");
  console.log(`       ${suggested.notify}\n`);
}
if (!summary) {
  console.log("HINT  Set KPAY_PWA_FRONTEND_RETURN_URL, e.g.:");
  console.log(`       ${suggested.summary}\n`);
}

const makeServerEntries = [...canonical.entries()].sort(([a], [b]) => a.localeCompare(b));
const webhookEntries = makeServerEntries.filter(([k]) =>
  ["KPAY_SIGN_KEY", "KPAY_ENV", "KPAY_WEBHOOK_UAT_TRUST_NOTIFY"].includes(k),
);

console.log("--- Paste into TCB → make-server-16010b6f → Environment variables ---\n");
console.log(formatBlock("make-server-16010b6f", makeServerEntries));
console.log("\n--- Paste into TCB → kpay-webhook (+ same CLOUDBASE_* / TENCENT_* as make-server) ---\n");
console.log(formatBlock("kpay-webhook (KPay only)", webhookEntries));
console.log("\nDone. ~50 Supabase names often collapse to ~15–25 canonical vars.");
