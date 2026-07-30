-- Extend the public-safe KV domain pulse with notification changes.
-- CloudBase clients poll this small counter endpoint because TencentDB does not
-- expose Supabase postgres_changes WebSockets.

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
      'notifications'
    )
  );

INSERT INTO public.app_kv_domain_pulse (domain, bump, detail, updated_at)
VALUES ('notifications', 0, '{}'::jsonb, now())
ON CONFLICT (domain) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_app_kv_domain_pulse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kv_key text := COALESCE(NEW.key, OLD.key);
  kv_domain text := NULL;
  kv_detail jsonb := '{}'::jsonb;
  audience_vendor_id text;
BEGIN
  IF kv_key IS NULL OR kv_key = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF kv_key LIKE 'product:%' THEN
    kv_domain := 'products';
  ELSIF kv_key LIKE 'category:%' THEN
    kv_domain := 'categories';
  ELSIF kv_key LIKE 'notification:%' THEN
    kv_domain := 'notifications';
  ELSIF kv_key LIKE 'vendor:audience:%' THEN
    kv_domain := 'customers';
    audience_vendor_id := btrim(substr(kv_key, length('vendor:audience:') + 1));
    IF audience_vendor_id <> '' THEN
      kv_detail := jsonb_build_object(
        'event',
        'audience',
        'vendorIds',
        jsonb_build_array(audience_vendor_id)
      );
    ELSE
      kv_detail := jsonb_build_object('event', 'audience');
    END IF;
  ELSIF kv_key LIKE 'customer:%'
     OR kv_key LIKE 'user:%'
     OR kv_key LIKE 'auth:user:%'
     OR kv_key LIKE 'userId:%' THEN
    kv_domain := 'customers';
    kv_detail := jsonb_build_object('event', 'audience');
  ELSIF kv_key LIKE 'vendor_application:%' THEN
    RETURN COALESCE(NEW, OLD);
  ELSIF kv_key LIKE 'vendor:%'
     OR kv_key LIKE 'vendor_settings:%'
     OR kv_key LIKE 'vendor_storefront_%'
     OR kv_key LIKE 'vendor_slug_%' THEN
    kv_domain := 'vendors';
  ELSIF kv_key LIKE 'campaign:%'
     OR kv_key LIKE 'coupon:%' THEN
    kv_domain := 'marketing';
  END IF;

  IF kv_domain IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.app_kv_domain_pulse
  SET bump = bump + 1,
      detail = kv_detail,
      updated_at = now()
  WHERE domain = kv_domain;

  RETURN COALESCE(NEW, OLD);
END;
$$;
