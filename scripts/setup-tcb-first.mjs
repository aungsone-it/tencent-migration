#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnvFile, projectRoot } from "./load-env.mjs";

loadEnvFile();

const root = projectRoot();
const targetUrl = process.env.TENCENT_DATABASE_URL || process.env.TENCENTDB_DATABASE_URL || "";

function run(label, command, args, extraEnv = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

console.log("TCB-first setup: schema-only migration + function packaging\n");

if (!targetUrl) {
  console.warn(
    [
      "SKIP schema migration: TENCENT_DATABASE_URL is not set in .env",
      "",
      "Add this to .env after your TencentDB instance is ready:",
      'TENCENT_DATABASE_URL="postgresql://postgres:PASSWORD@HOST:5432/postgres"',
      "",
      "Then re-run: npm run setup:tcb-first",
      "",
      "Prerequisites in Tencent console:",
      "- Link TencentDB to CloudBase env (Relational Database)",
      "- Security group allows your IP on TCP 5432 (temporary for migration)",
    ].join("\n"),
  );
} else {
  run("Apply schema-only migrations to TencentDB", "node", [
    path.join("scripts", "migrate-to-tencentdb.mjs"),
  ], {
    TENCENT_DATABASE_URL: targetUrl,
    SKIP_DATA_COPY: "1",
  });
}

run("Prepare CloudBase function packages", "node", ["scripts/prepare-cloudbase-functions.mjs"]);
run("Create console upload zip files", "node", ["scripts/package-cloudbase-console.mjs"]);

console.log("\nNext steps:");
console.log("1. Upload zips from .cloudbase/dist/ in TCB console (see docs/TCB_CONSOLE_SETUP.md)");
console.log("2. Set function env vars from cloudbase/function-env.template.env");
console.log("3. Create HTTP Gateway route for make-server-16010b6f");
console.log("4. npm run build && deploy dist/ to EdgeOne");
console.log("5. npm run smoke:tcb");
