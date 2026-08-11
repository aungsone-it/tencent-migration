-- Extend KV domain pulse with staff session revocation for forced logout.
-- Admin clients poll this counter when a staff account is deactivated or deleted.

ALTER TABLE public.app_kv_domain_pulse
  DROP CONSTRAINT IF EXISTS app_kv_domain_pulse_domain_check;

ALTER TABLE public.app_kv_domain_pulse
  ADD CONSTRAINT app_kv_domain_pulse_domain_check
  CHECK (
    domain IN (
      'products',
      'categories',
      'customers',
      'vendors',
      'marketing',
      'notifications',
      'staff_sessions'
    )
  );

INSERT INTO public.app_kv_domain_pulse (domain, bump, detail, updated_at)
VALUES ('staff_sessions', 0, '{}'::jsonb, now())
ON CONFLICT (domain) DO NOTHING;
