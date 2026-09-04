/**
 * Delete subscription + vendor withdrawal test KV rows (same scope as scripts/reset-subscription-test-data.sql).
 */
type PgPoolLike = {
  query(sql: string, values?: unknown[]): Promise<{ rowCount?: number | null; rows: Record<string, unknown>[] }>;
};

let pgPool: PgPoolLike | null = null;

function runtimeEnv(name: string): string {
  const deno = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno;
  const fromDeno = deno?.env?.get?.(name);
  if (fromDeno) return fromDeno;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return String(proc?.env?.[name] || "").trim();
}

function postgresConnectionString(): string {
  return (
    runtimeEnv("TENCENT_DATABASE_URL") ||
    runtimeEnv("TENCENTDB_DATABASE_URL") ||
    runtimeEnv("DATABASE_URL") ||
    runtimeEnv("POSTGRES_URL")
  );
}

function getPgPool(): PgPoolLike {
  if (pgPool) return pgPool;
  const connectionString = postgresConnectionString();
  if (!connectionString) throw new Error("TENCENT_DATABASE_URL is not configured");
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  return pgPool;
}

const COUNT_SQL = `
SELECT
  count(*) FILTER (WHERE key LIKE 'subscription_payment:%')::int AS subscription_payments,
  count(*) FILTER (WHERE key LIKE 'customer_subscription:%')::int AS customer_subscriptions,
  count(*) FILTER (WHERE key LIKE 'subscription_plan:%')::int AS subscription_plans,
  count(*) FILTER (WHERE key LIKE 'kpay_txn:SUB%')::int AS sub_kpay_txns,
  count(*) FILTER (WHERE key LIKE 'vendor_withdrawals:%')::int AS vendor_withdrawals,
  count(*) FILTER (WHERE key LIKE 'vendor_withdraw_lock:%')::int AS vendor_withdraw_locks,
  count(*) FILTER (WHERE key LIKE 'vendor_withdrawal_txn:%')::int AS vendor_withdrawal_txns,
  count(*) FILTER (WHERE key LIKE 'kpay_txn:VWD-%')::int AS withdraw_kpay_txns
FROM public.kv_store_16010b6f;
`;

const DELETE_STEPS: Array<{ label: string; sql: string }> = [
  {
    label: "subscription_payments",
    sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'subscription_payment:%'`,
  },
  {
    label: "customer_subscriptions",
    sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'customer_subscription:%'`,
  },
  {
    label: "subscription_plans",
    sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'subscription_plan:%'`,
  },
  {
    label: "sub_kpay_txns",
    sql: `DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'kpay_txn:SUB%'`,
  },
  {
    label: "vendor_withdrawals",
    sql: `
DELETE FROM public.kv_store_16010b6f
WHERE key LIKE 'vendor_withdrawals:%'
   OR key LIKE 'vendor_withdraw_lock:%'
   OR key LIKE 'vendor_withdrawal_txn:%'
   OR key LIKE 'kpay_txn:VWD-%'`,
  },
];

export type SubscriptionResetCounts = Record<string, number>;

export async function countSubscriptionTestData(): Promise<SubscriptionResetCounts> {
  const pool = getPgPool();
  const result = await pool.query(COUNT_SQL);
  return result.rows[0] as SubscriptionResetCounts;
}

export async function resetSubscriptionTestData(): Promise<{
  before: SubscriptionResetCounts;
  after: SubscriptionResetCounts;
  deletedByStep: Record<string, number>;
}> {
  const pool = getPgPool();
  const before = await countSubscriptionTestData();
  const deletedByStep: Record<string, number> = {};
  const client = await (pool as any).connect();
  try {
    await client.query("BEGIN");
    for (const step of DELETE_STEPS) {
      const result = await client.query(step.sql);
      deletedByStep[step.label] = result.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const after = await countSubscriptionTestData();
  return { before, after, deletedByStep };
}
