#!/usr/bin/env node
/**
 * Reset subscription + related vendor payout KV rows in TencentDB.
 *
 *   npm run db:reset-subscriptions
 *   npm run db:reset-subscriptions -- --dry-run
 */
import pg from "pg";
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const { Pool } = pg;
const dbUrl = process.env.TENCENT_DATABASE_URL || process.env.TENCENTDB_DATABASE_URL || "";
const dryRun = process.argv.includes("--dry-run");

const COUNT_SQL = `
SELECT
  count(*) FILTER (WHERE key LIKE 'subscription_payment:%') AS subscription_payments,
  count(*) FILTER (WHERE key LIKE 'customer_subscription:%') AS customer_subscriptions,
  count(*) FILTER (WHERE key LIKE 'subscription_plan:%') AS subscription_plans,
  count(*) FILTER (WHERE key LIKE 'kpay_txn:SUB%') AS sub_kpay_txns,
  count(*) FILTER (WHERE key LIKE 'vendor_withdrawals:%') AS vendor_withdrawals,
  count(*) FILTER (WHERE key LIKE 'vendor_withdraw_lock:%') AS vendor_withdraw_locks,
  count(*) FILTER (WHERE key LIKE 'vendor_withdrawal_txn:%') AS vendor_withdrawal_txns,
  count(*) FILTER (WHERE key LIKE 'kpay_txn:VWD-%') AS withdraw_kpay_txns
FROM public.kv_store_16010b6f;
`;

const DELETE_STEPS = [
  { label: "subscription payments", sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'subscription_payment:%'` },
  { label: "customer subscriptions", sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'customer_subscription:%'` },
  { label: "subscription plans", sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'subscription_plan:%'` },
  { label: "KBZPay SUB* txns", sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'kpay_txn:SUB%'` },
  {
    label: "vendor withdrawals + locks",
    sql: `
DELETE FROM public.kv_store_16010b6f
WHERE key LIKE 'vendor_withdrawals:%'
   OR key LIKE 'vendor_withdraw_lock:%'
   OR key LIKE 'vendor_withdrawal_txn:%'
   OR key LIKE 'kpay_txn:VWD-%'`,
  },
];

function printCounts(row, title) {
  console.log(`\n=== ${title} ===`);
  for (const [key, value] of Object.entries(row)) {
    console.log(`  ${key}: ${value}`);
  }
}

if (!dbUrl) {
  console.error("TENCENT_DATABASE_URL is not set in .env");
  console.error("Add your TencentDB connection string, then re-run: npm run db:reset-subscriptions");
  process.exit(1);
}

const host = dbUrl.replace(/^postgresql:\/\/[^@]+@([^/?]+).*/, "$1");
const portMatch = dbUrl.match(/:(\d+)\//);
const port = portMatch?.[1] ?? "unknown";

console.log(`Target: ${host}`);
console.log(`Port: ${port} (verify in Tencent console → Connection info; docs use 23100)`);
if (dryRun) console.log("[dry-run] Preflight counts only — no deletes.");

const pool = new Pool({
  connectionString: dbUrl,
  max: 1,
  connectionTimeoutMillis: 15_000,
  ssl: dbUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

try {
  const before = (await pool.query(COUNT_SQL)).rows[0];
  printCounts(before, "Preflight counts");

  if (dryRun) {
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const step of DELETE_STEPS) {
      const result = await client.query(step.sql);
      console.log(`Deleted ${result.rowCount ?? 0} rows — ${step.label}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const after = (await pool.query(COUNT_SQL)).rows[0];
  printCounts(after, "Post-reset counts (expect zeros)");

  console.log("\n✓ Subscription + withdrawal test data reset complete.");
  console.log("Clear Finances cache in browser:");
  console.log("  localStorage.removeItem('migoo-ls-admin-finances-analytics-v1'); location.reload();");
} catch (error) {
  const msg = error.message || String(error);
  console.error("\nReset failed:", msg);
  if (/timeout|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
    console.error("\nDirect DB access checklist:");
    console.error("  1. Tencent console → TencentDB → Connection info → copy PUBLIC host + port");
    console.error("  2. Security group → inbound TCP on that port → add your laptop public IP");
    console.error("  3. Update TENCENT_DATABASE_URL in .env (URL-encode special chars in password)");
    console.error("  4. If port in .env differs from console (e.g. 23198 vs 23100), fix the port");
    console.error("\nAlternative (no VPN to DB): deploy function, then:");
    console.error("  npm run deploy:functions");
    console.error("  npm run db:reset-subscriptions:api -- --dry-run");
  }
  process.exit(1);
} finally {
  await pool.end();
}
