#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, ".cloudbase", "functions");
const makeSource = path.join(root, "supabase", "functions", "make-server-16010b6f");
const webhookSource = path.join(root, "supabase", "functions", "kpay-webhook");

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function wrapperSource(entry, routePrefix) {
  return `require("tsx/cjs");
const tcb = require("@cloudbase/node-sdk");

try {
  globalThis.cloudbaseApp = tcb.init({ env: tcb.SYMBOL_DEFAULT_ENV });
} catch {
  // Local packaging/build verification can run outside CloudBase.
}

globalThis.Deno = globalThis.Deno || {
  env: {
    get(name) {
      return process.env[name];
    },
  },
  serve() {
    // Source modules export handlers; CloudBase invokes exports.main below.
  },
};

globalThis.addEventListener = globalThis.addEventListener || function addEventListener() {};
globalThis.removeEventListener = globalThis.removeEventListener || function removeEventListener() {};

function loadModule() {
  return require(${JSON.stringify(entry)});
}

function eventPath(event) {
  const raw =
    event?.path ||
    event?.requestContext?.path ||
    event?.rawPath ||
    event?.headers?.["x-original-uri"] ||
    "/";
  let pathname = String(raw || "/");
  if (!pathname.startsWith("/")) pathname = "/" + pathname;
  ${routePrefix ? `if (!pathname.startsWith(${JSON.stringify(routePrefix)})) pathname = ${JSON.stringify(routePrefix)} + (pathname === "/" ? "" : pathname);` : ""}
  return pathname;
}

function eventQuery(event) {
  if (event?.rawQueryString) return String(event.rawQueryString);
  const params = event?.queryStringParameters || event?.query || {};
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, String(v)));
    else search.set(key, String(value));
  }
  return search.toString();
}

function eventHeaders(event) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event?.headers || {})) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return headers;
}

function eventBody(event) {
  if (event?.body == null) return undefined;
  if (event?.isBase64Encoded) return Buffer.from(String(event.body), "base64");
  return typeof event.body === "string" ? event.body : JSON.stringify(event.body);
}

async function toRequest(event) {
  const query = eventQuery(event);
  const url = new URL(eventPath(event) + (query ? "?" + query : ""), "https://cloudbase.local");
  return new Request(url, {
    method: event?.httpMethod || event?.method || event?.requestContext?.http?.method || "GET",
    headers: eventHeaders(event),
    body: ["GET", "HEAD"].includes(String(event?.httpMethod || event?.method || "GET").toUpperCase())
      ? undefined
      : eventBody(event),
  });
}

async function fromResponse(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false,
  };
}

exports.main = async function main(event = {}, context = {}) {
  const mod = loadModule();
  const handler = mod.handleRequest;
  if (typeof handler !== "function") {
    return { statusCode: 500, body: "CloudBase handler export missing" };
  }
  return fromResponse(await handler(await toRequest(event, context)));
};
`;
}

function writeFunctionPackage(name, sourceWriter) {
  const dest = path.join(outRoot, name);
  rmrf(dest);
  fs.mkdirSync(dest, { recursive: true });
  writeJson(path.join(dest, "package.json"), {
    name,
    version: "0.0.0",
    private: true,
    type: "commonjs",
    main: "index.cjs",
    dependencies: {
      "@cloudbase/node-sdk": "^3.1.0",
      hono: "^4.10.0",
      tsx: "^4.21.0",
      ws: "^8.18.3",
    },
  });
  sourceWriter(dest);
}

writeFunctionPackage("make-server-16010b6f", (dest) => {
  copyDir(makeSource, path.join(dest, "src"));
  fs.writeFileSync(
    path.join(dest, "index.cjs"),
    wrapperSource("./src/index.tsx", "/make-server-16010b6f"),
  );
});

writeFunctionPackage("kpay-webhook", (dest) => {
  copyDir(webhookSource, path.join(dest, "src"));
  copyDir(makeSource, path.join(dest, "make-server-16010b6f"));
  fs.writeFileSync(
    path.join(dest, "index.cjs"),
    wrapperSource("./src/index.ts", ""),
  );
});

console.log(`Prepared CloudBase functions in ${path.relative(root, outRoot)}`);
