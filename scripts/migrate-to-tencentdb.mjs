#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const targetUrl = process.env.TENCENT_DATABASE_URL || process.env.TENCENTDB_DATABASE_URL || "";
const sourceUrl = process.env.SOURCE_POSTGRES_URL || process.env.SOURCE_DATABASE_URL || "";
const skipData = process.env.SKIP_DATA_COPY === "1";

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

if (!targetUrl) {
  console.error("Set TENCENT_DATABASE_URL to your TencentDB for PostgreSQL connection string.");
  process.exit(2);
}

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

console.log(`Applying ${migrations.length} SQL migration(s) to TencentDB...`);
for (const name of migrations) {
  const file = path.join(migrationsDir, name);
  console.log(`\n==> ${name}`);
  run("psql", [targetUrl, "-v", "ON_ERROR_STOP=1", "-f", file]);
}

if (skipData) {
  console.log("\nSKIP_DATA_COPY=1 set; schema migration complete.");
  process.exit(0);
}

if (!sourceUrl) {
  console.log(
    "\nNo SOURCE_POSTGRES_URL provided; schema migration complete. " +
      "Set SOURCE_POSTGRES_URL to copy existing KV/read-model data.",
  );
  process.exit(0);
}

const tables = [
  "kv_store_16010b6f",
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

console.log("\nCopying application tables from source Postgres to TencentDB...");
for (const table of tables) {
  console.log(`\n==> ${table}`);
  const dump = spawnSync("pg_dump", [
    sourceUrl,
    "--data-only",
    "--column-inserts",
    "--no-owner",
    "--no-privileges",
    "--table",
    `public.${table}`,
  ], { encoding: "utf8" });
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

console.log("\nTencentDB migration complete. Run npm run validate:read-model against CloudBase API next.");
