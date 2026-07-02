#!/usr/bin/env node

const API_BASE_URL = (
  process.env.CLOUDBASE_API_BASE_URL ||
  process.env.TENCENT_API_BASE_URL ||
  process.env.VITE_CLOUDBASE_API_BASE_URL ||
  ""
).replace(/\/+$/, "");
const TOKEN = (
  process.env.CLOUDBASE_PUBLISHABLE_KEY ||
  process.env.TCB_PUBLISHABLE_KEY ||
  process.env.VITE_CLOUDBASE_PUBLISHABLE_KEY ||
  ""
).trim();

if (!API_BASE_URL) {
  console.error("Set CLOUDBASE_API_BASE_URL first.");
  console.error("  export CLOUDBASE_API_BASE_URL=https://api.example.com/make-server-16010b6f");
  console.error("  npm run kpay:urls");
  process.exit(1);
}
const res = await fetch(`${API_BASE_URL}/kpay/resolved-urls`, {
  headers: {
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  },
});

if (!res.ok) {
  console.error(`Failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}

const payload = await res.json();
const urls = payload.urls || payload;
const rows = Object.entries(urls || {});

console.log("\nKPay endpoint URLs\n");
for (const [label, url] of rows) {
  console.log(`${String(label).padEnd(24)} ${url || "(not set)"}`);
}

console.log("");
