-- Reset ALL subscription + related vendor payout test data in TencentDB KV.
-- Safe to re-run. Does NOT delete orders, products, vendors, or customers.
--
-- Preferred (no psql required):
--   npm run db:reset-subscriptions
--   npm run db:reset-subscriptions -- --dry-run
--
-- Or with psql:
--   psql "$TENCENT_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-subscription-test-data.sql

\set ON_ERROR_STOP on

\echo '=== Subscription reset preflight ==='
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

BEGIN;

\echo '=== Deleting subscription payments (finances + vendor wallet source) ==='
DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'subscription_payment:%';

\echo '=== Deleting customer subscription entitlements ==='
DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'customer_subscription:%';

\echo '=== Deleting subscription plan catalog ==='
DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'subscription_plan:%';

\echo '=== Deleting KBZPay txn rows for subscription checkouts (SUB*) ==='
DELETE FROM public.kv_store_16010b6f WHERE key LIKE 'kpay_txn:SUB%';

\echo '=== Deleting vendor withdrawal history + locks (commission wallet test state) ==='
DELETE FROM public.kv_store_16010b6f
WHERE key LIKE 'vendor_withdrawals:%'
   OR key LIKE 'vendor_withdraw_lock:%'
   OR key LIKE 'vendor_withdrawal_txn:%'
   OR key LIKE 'kpay_txn:VWD-%';

COMMIT;

\echo '=== Post-reset counts (expect zeros) ==='
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

\echo 'Done. Hard-refresh Admin → Finances after reset.'
