#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile, projectRoot } from "./load-env.mjs";

loadEnvFile();

const targetUrl = process.env.TENCENT_DATABASE_URL || process.env.TENCENTDB_DATABASE_URL || "";
const sourceUrl = process.env.SOURCE_POSTGRES_URL || process.env.SOURCE_DATABASE_URL || "";

const sqlTables = ["app_vendors", "app_products", "app_product_skus"];

const kvWhere = `
  key LIKE 'product:%'
  OR (
    key LIKE 'vendor:%'
    AND key NOT LIKE 'vendor:audience:%'
  )
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

function runCapture(command, args, input) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}\n${result.stderr || ""}`,
    );
  }
  return result.stdout ?? "";
}

if (!targetUrl) {
  console.error("Set TENCENT_DATABASE_URL in .env");
  process.exit(2);
}

if (!sourceUrl) {
  console.error("Set SOURCE_POSTGRES_URL in .env");
  process.exit(2);
}

console.log("Vendor + product import only (no orders, auth, kpay, customers)\n");

console.log("==> Apply schema on TencentDB (no full data copy)");
run("node", [path.join("scripts", "migrate-to-tencentdb.mjs")], {
  cwd: projectRoot(),
  env: { ...process.env, TENCENT_DATABASE_URL: targetUrl, SKIP_DATA_COPY: "1" },
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-product-import-"));
const kvCsv = path.join(tmpDir, "kv_vendor_product.csv");

console.log("\n==> Export vendor/product KV rows from Supabase");
const kvExport = spawnSync(
  "psql",
  [
    sourceUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `COPY (SELECT key, value FROM public.kv_store_16010b6f WHERE ${kvWhere}) TO STDOUT WITH (FORMAT csv)`,
  ],
  { encoding: "buffer" },
);
if (kvExport.error) throw kvExport.error;
if (kvExport.status !== 0) {
  throw new Error(`KV export failed with exit ${kvExport.status}`);
}
fs.writeFileSync(kvCsv, kvExport.stdout);

console.log("\n==> Import vendor/product KV rows into TencentDB");
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
run("psql", [targetUrl, "-v", "ON_ERROR_STOP=1", "-f", kvImportSql]);

for (const table of sqlTables) {
  console.log(`\n==> ${table}`);
  const dump = spawnSync(
    "pg_dump",
    [
      sourceUrl,
      "--data-only",
      "--column-inserts",
      "--no-owner",
      "--no-privileges",
      "--table",
      `public.${table}`,
    ],
    { encoding: "utf8" },
  );
  if (dump.error) throw dump.error;
  if (dump.status !== 0) {
    console.warn(`Skipping ${table}: pg_dump failed or table missing.`);
    continue;
  }
  const restore = spawnSync("psql", [targetUrl, "-v", "ON_ERROR_STOP=1"], {
    input: dump.stdout,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });
  if (restore.error) throw restore.error;
  if (restore.status !== 0) throw new Error(`Restore failed for ${table}`);
}

const vendorKvCount = runCapture("psql", [sourceUrl, "-t", "-A", "-c", `SELECT count(*) FROM public.kv_store_16010b6f WHERE ${kvWhere}`]).trim();
const vendorSqlCount = runCapture("psql", [sourceUrl, "-t", "-A", "-c", "SELECT count(*) FROM public.app_vendors"]).trim();
const productSqlCount = runCapture("psql", [sourceUrl, "-t", "-A", "-c", "SELECT count(*) FROM public.app_products"]).trim();

console.log("\nSource counts:");
console.log(`  KV vendor/product keys: ${vendorKvCount}`);
console.log(`  app_vendors rows:       ${vendorSqlCount}`);
console.log(`  app_products rows:      ${productSqlCount}`);

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // ignore cleanup errors
}

console.log("\nVendor + product import complete.");
console.log("Skipped: orders, customers, notifications, kpay_txn, auth users.");
console.log("Next:");
console.log("1. Copy product images from Supabase Storage to CloudBase Storage (files are not in Postgres).");
console.log("2. Smoke-test vendor storefront + admin product list.");
