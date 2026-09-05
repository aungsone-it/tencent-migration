#!/usr/bin/env node
/**
 * Local HTTP shim for make-server-16010b6f (CloudBase wrapper on port 8787).
 * Use with Vite proxy: VITE_CLOUDBASE_API_BASE_URL=/api/make-server-16010b6f npm run dev
 */
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadEnvFile, projectRoot } from "./load-env.mjs";

const require = createRequire(import.meta.url);
const root = projectRoot();
const fnDir = path.join(root, ".cloudbase", "functions", "make-server-16010b6f");
const port = Number(process.env.LOCAL_API_PORT || 8787);

function ensureBundle() {
  const bundleEntry = path.join(fnDir, "index.js");
  const bundledApp = path.join(fnDir, "app.cjs");
  const sourceDir = path.join(root, "supabase", "functions", "make-server-16010b6f");
  const sourceMtime = latestMtime(sourceDir);
  const bundleMtime = fs.existsSync(bundledApp) ? fs.statSync(bundledApp).mtimeMs : 0;
  const needsRebuild = !fs.existsSync(bundleEntry) || sourceMtime > bundleMtime;

  if (needsRebuild) {
    console.log("Preparing CloudBase function bundle…");
    const r = spawnSync("node", ["scripts/prepare-cloudbase-functions.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
    if (r.status !== 0) process.exit(r.status || 1);
  }

  const nodeModules = path.join(fnDir, "node_modules", "pg");
  if (!fs.existsSync(nodeModules)) {
    console.log("Installing CloudBase function dependencies (pg)…");
    const install = spawnSync("npm", ["install", "--omit=dev"], {
      cwd: fnDir,
      stdio: "inherit",
    });
    if (install.status !== 0) process.exit(install.status || 1);
  }
}

function latestMtime(dir) {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtime(fullPath));
      continue;
    }
    if (!/\.(tsx?|jsx?|mjs|cjs|json)$/.test(entry.name)) continue;
    latest = Math.max(latest, fs.statSync(fullPath).mtimeMs);
  }
  return latest;
}

loadEnvFile();
ensureBundle();

process.chdir(fnDir);
const { main } = require(path.join(fnDir, "index.js"));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const body = ["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())
      ? undefined
      : await readBody(req);

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      headers[key] = Array.isArray(value) ? value.join(",") : String(value);
    }

    const event = {
      httpMethod: req.method || "GET",
      path: url.pathname,
      rawPath: url.pathname,
      rawQueryString: url.searchParams.toString(),
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      headers,
      body,
      isBase64Encoded: false,
      requestContext: {
        http: { method: req.method || "GET", path: url.pathname },
      },
    };

    const out = await main(event, {});
    const status = out?.statusCode || 500;
    const outHeaders = out?.headers && typeof out.headers === "object" ? out.headers : {};
    for (const [key, value] of Object.entries(outHeaders)) {
      if (value != null) res.setHeader(key, String(value));
    }

    if (!res.getHeader("access-control-allow-origin")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    let payload = out?.body ?? "";
    if (out?.isBase64Encoded && typeof payload === "string") {
      payload = Buffer.from(payload, "base64");
    }
    res.writeHead(status);
    res.end(payload);
  } catch (error) {
    console.error("[local-api]", error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local make-server API → http://127.0.0.1:${port}/make-server-16010b6f/health`);
  console.log(`Point Vite at /api/make-server-16010b6f (see vite.config.ts proxy).`);
});
