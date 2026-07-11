#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile, projectRoot } from "./load-env.mjs";
import { copyQueryToFile, copyTableData, runCapture, runPsql } from "./psql-stream.mjs";

loadEnvFile();

const targetUrl = process.env.TENCENT_DATABASE_URL || process.env.TENCENTDB_DATABASE_URL || "";
const sourceUrl = process.env.SOURCE_POSTGRES_URL || process.env.SOURCE_DATABASE_URL || "";
const skipSchema = process.env.SKIP_SCHEMA === "1";
const skipKv = process.env.SKIP_KV === "1";

const sqlTables = [
  "app_vendors",
  "app_customers",
  "app_products",
  "app_product_skus",
  "app_orders",
  "app_order_items",
  "app_notifications",
  "app_order_pulse",
  "app_vendor_application_pulse",
  "app_kv_domain_pulse",
];

const kvExcludeWhere = `
  key NOT LIKE 'kpay_txn:%'
  AND key NOT LIKE 'kpay_pwa_draft:%'
  AND key NOT LIKE 'chat:%'
`.trim();

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

if (!targetUrl) {
  console.error("Set TENCENT_DATABASE_URL in .env");
  process.exit(2);
}

if (!sourceUrl) {
  console.error("Set SOURCE_POSTGRES_URL in .env");
  process.exit(2);
}

console.log("Import Supabase data into TencentDB");
console.log("Includes: vendors, products, orders, customers, auth, settings, notifications");
console.log("Skips: kpay_txn, kpay_pwa_draft, chat:* (you already have KPay on TCB)\n");

if (skipSchema) {
  console.log("SKIP_SCHEMA=1 — skipping schema migrations (data copy only)\n");
} else {
  console.log("==> Apply schema on TencentDB");
  run("node", [path.join("scripts", "migrate-to-tencentdb.mjs")], {
    cwd: projectRoot(),
    env: { ...process.env, TENCENT_DATABASE_URL: targetUrl, SKIP_DATA_COPY: "1" },
  });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "supabase-import-"));
const kvCsv = path.join(tmpDir, "kv_except_kpay_chat.csv");

if (skipKv) {
  console.log("SKIP_KV=1 — skipping KV export/import (SQL tables only)\n");
} else {
  console.log("\n==> Export KV rows (all except kpay + chat) — streaming to disk");
  copyQueryToFile(
    sourceUrl,
    `COPY (SELECT key, value FROM public.kv_store_16010b6f WHERE ${kvExcludeWhere}) TO STDOUT WITH (FORMAT csv)`,
    kvCsv,
  );
  const kvSizeMb = (fs.statSync(kvCsv).size / (1024 * 1024)).toFixed(1);
  console.log(`    exported ${kvSizeMb} MB`);

  console.log("\n==> Import KV rows into TencentDB");
  const kvImportSql = path.join(tmpDir, "kv_import.sql");
  fs.writeFileSync(
    kvImportSql,
    [
      "CREATE TEMP TABLE kv_import_stage (LIKE public.kv_store_16010b6f INCLUDING ALL);",
      "\\copy kv_import_stage FROM '" + kvCsv.replace(/'/g, "''") + "' WITH (FORMAT csv)",
      "INSERT INTO public.kv_store_16010b6f (key, value)",
      "SELECT key, value FROM kv_import_stage",
      "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;",
    ].join("\n"),
  );
  runPsql(targetUrl, ["-v", "ON_ERROR_STOP=1", "-f", kvImportSql]);
}

const prevCwd = process.cwd();
process.chdir(tmpDir);
try {
  for (const table of sqlTables) {
    console.log(`\n==> ${table}`);
    try {
      copyTableData(sourceUrl, targetUrl, table);
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes("pg_dump") && msg.includes("failed")) {
        console.warn(`Skipping ${table}: pg_dump failed or table missing.`);
        continue;
      }
      throw err;
    }
  }
} finally {
  process.chdir(prevCwd);
}

const kvCount = runCapture(
  sourceUrl,
  `SELECT count(*) FROM public.kv_store_16010b6f WHERE ${kvExcludeWhere}`,
);
const skippedKpay = runCapture(
  sourceUrl,
  `SELECT count(*) FROM public.kv_store_16010b6f WHERE key LIKE 'kpay_%' OR key LIKE 'chat:%'`,
);

console.log("\nSource summary:");
console.log(`  KV rows imported:     ${kvCount}`);
console.log(`  KV rows skipped:      ${skippedKpay} (kpay + chat)`);

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // ignore cleanup errors
}

console.log("\nImport complete.");
console.log("Next:");
console.log("1. Copy Supabase Storage files to CloudBase Storage (images/uploads).");
console.log("2. npm run validate:read-model");
console.log("3. npm run smoke:tcb");
console.log("4. Check admin: vendors, products, orders, customers.");
