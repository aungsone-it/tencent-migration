#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadEnvFile, projectRoot } from "./load-env.mjs";

loadEnvFile();

const targetUrl = process.env.TENCENT_DATABASE_URL || process.env.TENCENTDB_DATABASE_URL || "";
const sourceUrl = process.env.SOURCE_POSTGRES_URL || process.env.SOURCE_DATABASE_URL || "";

if (!targetUrl) {
  console.error("Set TENCENT_DATABASE_URL in .env");
  process.exit(2);
}

if (!sourceUrl) {
  console.error(
    [
      "Set SOURCE_POSTGRES_URL in .env to your Supabase direct Postgres connection string.",
      "",
      "Supabase: Project Settings -> Database -> Connection string (URI, direct)",
      "",
      "Example:",
      'SOURCE_POSTGRES_URL="postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"',
    ].join("\n"),
  );
  process.exit(2);
}

console.log("Importing Supabase Postgres data into TencentDB...");
console.log("This copies app tables only. Run storage/auth migration separately.\n");

const result = spawnSync("node", ["scripts/migrate-to-tencentdb.mjs"], {
  cwd: projectRoot(),
  stdio: "inherit",
  env: {
    ...process.env,
    TENCENT_DATABASE_URL: targetUrl,
    SOURCE_POSTGRES_URL: sourceUrl,
  },
});

if (result.status !== 0) process.exit(result.status ?? 1);

console.log("\nDatabase import complete.");
console.log("Next:");
console.log("1. Copy Supabase Storage objects to CloudBase Storage");
console.log("2. Migrate Supabase Auth users (likely password reset flow)");
console.log("3. npm run validate:read-model");
console.log("4. Smoke-test production flows before deleting Supabase");
