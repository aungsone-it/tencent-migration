#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectRoot } from "./load-env.mjs";

const root = projectRoot();
const functionsRoot = path.join(root, ".cloudbase", "functions");
const distRoot = path.join(root, ".cloudbase", "dist");

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function zipDir(name) {
  const source = path.join(functionsRoot, name);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing ${source}. Run npm run prepare:cloudbase-functions first.`);
  }
  const zipPath = path.join(distRoot, `${name}.zip`);
  const result = spawnSync("zip", ["-r", zipPath, "."], {
    cwd: source,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`zip failed for ${name}`);
  }
  console.log(`Created ${path.relative(root, zipPath)}`);
}

if (!fs.existsSync(functionsRoot)) {
  throw new Error("Missing .cloudbase/functions. Run npm run prepare:cloudbase-functions first.");
}

rmrf(distRoot);
fs.mkdirSync(distRoot, { recursive: true });

for (const name of ["make-server-16010b6f", "kpay-webhook"]) {
  zipDir(name);
}

const readme = `# CloudBase console upload packages

Upload these zip files in TCB console -> Cloud Function -> Create via code package:

- make-server-16010b6f.zip  (main API)
- kpay-webhook.zip          (KBZPay webhook)

After upload, set environment variables from ../function-env.template.env
Then create HTTP Gateway route -> make-server-16010b6f
`;

fs.writeFileSync(path.join(distRoot, "README.txt"), readme);
console.log(`\nConsole upload packages ready in ${path.relative(root, distRoot)}/`);
