-- Serialize subscription renewals per vendor/customer so two distinct paid checkouts cannot
-- both earn commission while only one 30-day entitlement is retained.
CREATE OR REPLACE FUNCTION public.rpc_confirm_subscription_payment(
  p_payment_key text,
  p_subscription_key text,
  p_subscription_template jsonb,
  p_paid_payment jsonb,
  p_period_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment jsonb;
  v_existing jsonb;
  v_subscription jsonb;
  v_paid_at timestamptz;
  v_old_end timestamptz;
  v_period_start timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_subscription_key, 0));

  SELECT value INTO v_payment
  FROM public.kv_store_16010b6f
  WHERE key = p_payment_key
  FOR UPDATE;

  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'Subscription payment not found';
  END IF;

  SELECT value INTO v_existing
  FROM public.kv_store_16010b6f
  WHERE key = p_subscription_key
  FOR UPDATE;

  IF lower(btrim(coalesce(v_payment->>'status', ''))) = 'paid' THEN
    IF v_existing IS NULL THEN
      RAISE EXCEPTION 'Paid subscription record requires repair';
    END IF;
    RETURN v_existing;
  END IF;

  v_paid_at := (p_paid_payment->>'paidAt')::timestamptz;
  BEGIN
    v_old_end := nullif(v_existing->>'currentPeriodEnd', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_old_end := NULL;
  END;
  v_period_start := CASE
    WHEN v_old_end IS NOT NULL AND v_old_end > v_paid_at THEN v_old_end
    ELSE v_paid_at
  END;

  v_subscription := p_subscription_template || jsonb_build_object(
    'id', coalesce(nullif(v_existing->>'id', ''), p_subscription_template->>'id'),
    'currentPeriodStart', to_jsonb(v_period_start),
    'currentPeriodEnd', to_jsonb(v_period_start + make_interval(days => greatest(1, p_period_days))),
    'createdAt', coalesce(nullif(v_existing->>'createdAt', ''), p_subscription_template->>'createdAt'),
    'updatedAt', p_subscription_template->'updatedAt'
  );

  INSERT INTO public.kv_store_16010b6f(key, value)
  VALUES (p_subscription_key, v_subscription)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

  INSERT INTO public.kv_store_16010b6f(key, value)
  VALUES (
    p_payment_key,
    p_paid_payment || jsonb_build_object('subscriptionId', v_subscription->>'id')
  )
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

  RETURN v_subscription;
END;
$$;
