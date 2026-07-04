-- TencentDB PostgreSQL schema bootstrap generated from supabase/migrations.
-- Safe for TencentDB: includes base KV table, skips Supabase Realtime publication, Supabase roles, and Supabase RLS policies.
-- Run in Tencent DMC SQL Window on database postgres / schema public.

CREATE TABLE IF NOT EXISTS public.kv_store_16010b6f (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);

-- ========================================
-- 20260328120000_catalog_vendor_pagination_rpc.sql
-- ========================================
-- Server-side pagination for storefront catalog and vendor storefront (kv_store_16010b6f).
-- Apply with: supabase db push / migration runner. Edge falls back to legacy scan if RPC missing.

CREATE OR REPLACE FUNCTION public.kv_product_price_num(v jsonb)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    CASE
      WHEN length(nullif(regexp_replace(coalesce(v->>'price', '0'), '[^0-9.]', '', 'g'), '')) > 0
      THEN nullif(regexp_replace(coalesce(v->>'price', '0'), '[^0-9.]', '', 'g'), '')::double precision
    END,
    0::double precision
  );
$$;

CREATE OR REPLACE FUNCTION public.kv_sales_vol_num(v jsonb)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(nullif(trim(coalesce(v->>'salesVolume', '')), ''), '0')::double precision;
$$;

CREATE OR REPLACE FUNCTION public.rpc_storefront_catalog(
  p_kind text,
  p_page int,
  p_page_size int,
  p_category text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_sort text DEFAULT 'featured',
  p_min_price double precision DEFAULT NULL,
  p_max_price double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lim int := LEAST(GREATEST(COALESCE(p_page_size, 24), 1), 100);
  off int := (GREATEST(COALESCE(p_page, 1), 1) - 1) * lim;
  st text := lower(trim(coalesce(nullif(trim(p_sort), ''), 'featured')));
  cat text := NULL;
  qpat text := NULL;
  sort_expr text;
  result jsonb;
BEGIN
  IF p_category IS NOT NULL AND length(trim(p_category)) > 0 AND lower(trim(p_category)) <> 'all' THEN
    cat := lower(trim(p_category));
  END IF;
  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;

  sort_expr := CASE st
    WHEN 'price-low' THEN 'public.kv_product_price_num(v) ASC NULLS LAST, coalesce(v->>''name'', '''') ASC'
    WHEN 'price-high' THEN 'public.kv_product_price_num(v) DESC NULLS LAST, coalesce(v->>''name'', '''') ASC'
    WHEN 'popular' THEN 'public.kv_sales_vol_num(v) DESC NULLS LAST, coalesce(v->>''name'', '''') ASC'
    WHEN 'newest' THEN 'coalesce(v->>''createDate'', v->>''createdAt'', '''') DESC NULLS LAST, coalesce(v->>''name'', '''') ASC'
    ELSE 'coalesce(v->>''name'', '''') ASC NULLS LAST'
  END;

  IF lower(trim(p_kind)) = 'bootstrap' THEN
    EXECUTE format($sql$
      WITH plat AS (
        SELECT value AS v
        FROM public.kv_store_16010b6f
        WHERE key LIKE 'product:%%'
          AND (
            (v->>'vendorId') IS NULL
            OR btrim(coalesce(v->>'vendorId', '')) = ''
            OR (v->>'vendorId') = 'migoo'
          )
          AND (
            (v->>'status') IS NULL
            OR lower(btrim(coalesce(v->>'status', ''))) = 'active'
          )
          AND ($1::text IS NULL OR lower(coalesce(v->>'category', '')) = $1::text)
          AND ($2::text IS NULL OR lower(coalesce(v->>'name', '')) LIKE $2::text)
          AND ($3::float8 IS NULL OR public.kv_product_price_num(v) >= $3::float8)
          AND ($4::float8 IS NULL OR public.kv_product_price_num(v) <= $4::float8)
      ),
      tc AS (SELECT count(*)::bigint AS c FROM plat),
      deals AS (
        SELECT coalesce(jsonb_agg(v ORDER BY sv DESC), '[]'::jsonb) AS j FROM (
          SELECT v, public.kv_sales_vol_num(v) AS sv
          FROM plat
          ORDER BY sv DESC NULLS LAST
          LIMIT 10
        ) s
      ),
      news AS (
        SELECT coalesce(jsonb_agg(v ORDER BY dt DESC), '[]'::jsonb) AS j FROM (
          SELECT v, coalesce(v->>'createDate', v->>'createdAt', '') AS dt
          FROM plat
          ORDER BY dt DESC NULLS LAST
          LIMIT 6
        ) s
      ),
      sorted AS (
        SELECT v FROM plat ORDER BY %s
      ),
      pagep AS (
        SELECT coalesce(jsonb_agg(v), '[]'::jsonb) AS j
        FROM (SELECT v FROM sorted LIMIT %s OFFSET %s) z
      )
      SELECT jsonb_build_object(
        'bootstrap', true,
        'total', (SELECT c FROM tc),
        'products', (SELECT j FROM pagep),
        'dealProducts', (SELECT j FROM deals),
        'newArrivals', (SELECT j FROM news),
        'page', 1,
        'pageSize', %s,
        'hasMore', (SELECT c FROM tc) > %s
      )
    $sql$, sort_expr, lim, off, lim, lim)
    INTO result
    USING cat, qpat, p_min_price, p_max_price;
    result := result || jsonb_build_object('sort', to_jsonb(coalesce(nullif(trim(p_sort), ''), 'featured')));
    RETURN result;
  END IF;

  IF lower(trim(p_kind)) = 'catalog' THEN
    EXECUTE format($sql$
      WITH plat AS (
        SELECT value AS v
        FROM public.kv_store_16010b6f
        WHERE key LIKE 'product:%%'
          AND (
            (v->>'vendorId') IS NULL
            OR btrim(coalesce(v->>'vendorId', '')) = ''
            OR (v->>'vendorId') = 'migoo'
          )
          AND (
            (v->>'status') IS NULL
            OR lower(btrim(coalesce(v->>'status', ''))) = 'active'
          )
          AND ($1::text IS NULL OR lower(coalesce(v->>'category', '')) = $1::text)
          AND ($2::text IS NULL OR lower(coalesce(v->>'name', '')) LIKE $2::text)
          AND ($3::float8 IS NULL OR public.kv_product_price_num(v) >= $3::float8)
          AND ($4::float8 IS NULL OR public.kv_product_price_num(v) <= $4::float8)
      ),
      tc AS (SELECT count(*)::bigint AS c FROM plat),
      sorted AS (
        SELECT v FROM plat ORDER BY %s
      ),
      pagep AS (
        SELECT coalesce(jsonb_agg(v), '[]'::jsonb) AS j
        FROM (SELECT v FROM sorted LIMIT %s OFFSET %s) z
      )
      SELECT jsonb_build_object(
        'catalog', true,
        'total', (SELECT c FROM tc),
        'products', (SELECT j FROM pagep),
        'page', %s,
        'pageSize', %s,
        'hasMore', (SELECT c FROM tc) > (%s + %s)
      )
    $sql$, sort_expr, lim, off, GREATEST(COALESCE(p_page, 1), 1), lim, off, lim)
    INTO result
    USING cat, qpat, p_min_price, p_max_price;
    result := result || jsonb_build_object('sort', to_jsonb(coalesce(nullif(trim(p_sort), ''), 'featured')));
    RETURN result;
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_vendor_storefront_products_page(
  p_vendor_id text,
  p_vendor_business_name text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 24,
  p_category text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_resolve_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lim int := LEAST(GREATEST(COALESCE(p_page_size, 24), 1), 100);
  off int := (GREATEST(COALESCE(p_page, 1), 1) - 1) * lim;
  cat text := NULL;
  qpat text := NULL;
  slug text := NULL;
  result jsonb;
BEGIN
  IF p_category IS NOT NULL AND length(trim(p_category)) > 0 AND lower(trim(p_category)) <> 'all' THEN
    cat := lower(trim(p_category));
  END IF;
  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;
  IF p_resolve_slug IS NOT NULL AND length(trim(p_resolve_slug)) > 0 THEN
    slug := trim(p_resolve_slug);
  END IF;

  IF slug IS NOT NULL THEN
    WITH hit AS (
      SELECT value AS v
      FROM public.kv_store_16010b6f
      WHERE key LIKE 'product:%'
        AND lower(btrim(coalesce(value->>'status', ''))) = 'active'
        AND (
          value->>'vendorId' = p_vendor_id
          OR (p_vendor_business_name IS NOT NULL AND value->>'vendor' = p_vendor_business_name)
          OR value->>'vendor' = p_vendor_id
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(value->'selectedVendors', '[]'::jsonb)) t(x)
            WHERE t.x = p_vendor_id
              OR (p_vendor_business_name IS NOT NULL AND t.x = p_vendor_business_name)
          )
        )
        AND (
          lower(trim(coalesce(value->>'sku', ''))) = lower(slug)
          OR lower(trim(coalesce(value->>'id', ''))) = lower(slug)
          OR lower(
            regexp_replace(
              regexp_replace(trim(coalesce(value->>'name', '')), '[^\w\s-]', '', 'g'),
              '\s+',
              '-',
              'g'
            )
          ) = lower(slug)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(value->'variants', '[]'::jsonb)) var
            WHERE lower(trim(coalesce(var->>'sku', ''))) = lower(slug)
          )
        )
      LIMIT 1
    )
    SELECT jsonb_build_object(
      'products', coalesce((SELECT jsonb_agg(v) FROM hit), '[]'::jsonb),
      'total', (SELECT count(*)::bigint FROM hit),
      'page', 1,
      'pageSize', 1,
      'hasMore', false
    )
    INTO result;
    RETURN coalesce(result, jsonb_build_object('products', '[]'::jsonb, 'total', 0, 'page', 1, 'pageSize', 1, 'hasMore', false));
  END IF;

  WITH plat AS (
    SELECT value AS v
    FROM public.kv_store_16010b6f
    WHERE key LIKE 'product:%'
      AND lower(btrim(coalesce(value->>'status', ''))) = 'active'
      AND (
        value->>'vendorId' = p_vendor_id
        OR (p_vendor_business_name IS NOT NULL AND value->>'vendor' = p_vendor_business_name)
        OR value->>'vendor' = p_vendor_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(value->'selectedVendors', '[]'::jsonb)) t(x)
          WHERE t.x = p_vendor_id
            OR (p_vendor_business_name IS NOT NULL AND t.x = p_vendor_business_name)
        )
      )
      AND (cat IS NULL OR lower(coalesce(v->>'category', '')) = cat)
      AND (qpat IS NULL OR lower(coalesce(v->>'name', '')) LIKE qpat OR lower(coalesce(v->>'sku', '')) LIKE qpat)
  ),
  tc AS (SELECT count(*)::bigint AS c FROM plat),
  sorted AS (
    SELECT v FROM plat
    ORDER BY coalesce(v->>'createDate', v->>'createdAt', '') DESC NULLS LAST, coalesce(v->>'name', '') ASC
  ),
  pagep AS (
    SELECT coalesce(jsonb_agg(v), '[]'::jsonb) AS j
    FROM (SELECT v FROM sorted LIMIT lim OFFSET off) z
  )
  SELECT jsonb_build_object(
    'products', (SELECT j FROM pagep),
    'total', (SELECT c FROM tc),
    'page', GREATEST(COALESCE(p_page, 1), 1),
    'pageSize', lim,
    'hasMore', (SELECT c FROM tc) > (off + lim)
  )
  INTO result;

  RETURN coalesce(result, jsonb_build_object('products', '[]'::jsonb, 'total', 0, 'page', 1, 'pageSize', lim, 'hasMore', false));
END;
$$;

-- skipped Supabase role grant
-- skipped Supabase role grant
-- skipped Supabase role grant
-- skipped Supabase role grant

-- ========================================
-- 20260328150000_kv_product_filter_indexes.sql
-- ========================================
-- Indexes for catalog RPCs on kv_store_16010b6f (JSONB product rows under key LIKE 'product:%').
-- Partial indexes keep size down and match storefront / vendor filter patterns.
-- Requires prior migration defining public.kv_product_price_num / public.kv_sales_vol_num.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Substring search on product name (guest search uses LIKE '%q%')
CREATE INDEX IF NOT EXISTS idx_kv_products_name_trgm
  ON public.kv_store_16010b6f
  USING gin (lower(coalesce(value ->> 'name', '')) gin_trgm_ops)
  WHERE key LIKE 'product:%';

-- Category equality (RPC uses lower(coalesce(v->>'category','')) = $cat)
CREATE INDEX IF NOT EXISTS idx_kv_products_category_lower
  ON public.kv_store_16010b6f (lower(coalesce(value ->> 'category', '')))
  WHERE key LIKE 'product:%';

-- Active vendor-scoped listings (vendorId + active status + category)
CREATE INDEX IF NOT EXISTS idx_kv_products_vendor_status_category
  ON public.kv_store_16010b6f (
    (value ->> 'vendorId'),
    lower(btrim(coalesce(value ->> 'status', ''))),
    lower(coalesce(value ->> 'category', ''))
  )
  WHERE key LIKE 'product:%';

-- Legacy vendor string field (products keyed by business name)
CREATE INDEX IF NOT EXISTS idx_kv_products_vendor_field_lower
  ON public.kv_store_16010b6f (
    lower(coalesce(value ->> 'vendor', '')),
    lower(btrim(coalesce(value ->> 'status', '')))
  )
  WHERE key LIKE 'product:%';

-- Platform catalog slice: migoo / empty vendor + active + category (narrow partial for /store)
CREATE INDEX IF NOT EXISTS idx_kv_products_platform_active_category
  ON public.kv_store_16010b6f (lower(coalesce(value ->> 'category', '')))
  WHERE key LIKE 'product:%'
    AND (
      (value ->> 'vendorId') IS NULL
      OR btrim(coalesce(value ->> 'vendorId', '')) = ''
      OR (value ->> 'vendorId') = 'migoo'
    )
    AND (
      (value ->> 'status') IS NULL
      OR lower(btrim(coalesce(value ->> 'status', ''))) = 'active'
    );

-- Numeric price filters and price sort (uses same expression as RPC)
CREATE INDEX IF NOT EXISTS idx_kv_products_price_num
  ON public.kv_store_16010b6f (public.kv_product_price_num(value))
  WHERE key LIKE 'product:%';

-- Popular sort
CREATE INDEX IF NOT EXISTS idx_kv_products_sales_vol
  ON public.kv_store_16010b6f (public.kv_sales_vol_num(value) DESC NULLS LAST)
  WHERE key LIKE 'product:%';

-- Newest sort (text ordering matches RPC)
CREATE INDEX IF NOT EXISTS idx_kv_products_created_text
  ON public.kv_store_16010b6f (coalesce(value ->> 'createDate', value ->> 'createdAt', '') DESC)
  WHERE key LIKE 'product:%';

-- Product title / default sort by name
CREATE INDEX IF NOT EXISTS idx_kv_products_name_sort
  ON public.kv_store_16010b6f (coalesce(value ->> 'name', '') ASC NULLS LAST)
  WHERE key LIKE 'product:%';

-- Slug resolve: SKU, id, URL slug from name (same expressions as rpc_vendor_storefront_products_page)
CREATE INDEX IF NOT EXISTS idx_kv_products_sku_lower
  ON public.kv_store_16010b6f (lower(trim(coalesce(value ->> 'sku', ''))))
  WHERE key LIKE 'product:%'
    AND length(trim(coalesce(value ->> 'sku', ''))) > 0;

CREATE INDEX IF NOT EXISTS idx_kv_products_id_lower
  ON public.kv_store_16010b6f (lower(trim(coalesce(value ->> 'id', ''))))
  WHERE key LIKE 'product:%'
    AND length(trim(coalesce(value ->> 'id', ''))) > 0;

CREATE INDEX IF NOT EXISTS idx_kv_products_name_slug_lower
  ON public.kv_store_16010b6f (
    lower(
      regexp_replace(
        regexp_replace(trim(coalesce(value ->> 'name', '')), '[^\w\s-]', '', 'g'),
        '\s+',
        '-',
        'g'
      )
    )
  )
  WHERE key LIKE 'product:%';

-- Multi-vendor array: helps @> / containment style filters when planner chooses them
CREATE INDEX IF NOT EXISTS idx_kv_products_selected_vendors_gin
  ON public.kv_store_16010b6f
  USING gin ((value -> 'selectedVendors'))
  WHERE key LIKE 'product:%'
    AND jsonb_typeof(value -> 'selectedVendors') = 'array';

COMMENT ON INDEX public.idx_kv_products_name_trgm IS 'Speeds ILIKE/LIKE substring search on product names';
COMMENT ON INDEX public.idx_kv_products_platform_active_category IS 'Narrows platform (migoo) catalog before sort/paginate';

-- Skipped 20260430120000_enable_realtime_kv_kpay.sql: Supabase Realtime publication only.

-- ========================================
-- 20260503120000_order_realtime_pulse.sql
-- ========================================
-- Public-safe realtime “heartbeat” for order KV changes.
-- Browsers subscribe to this one row only (no PII). A trigger bumps the counter when
-- kv_store_16010b6f gets an INSERT/UPDATE on keys like order:%, avoiding expensive
-- polling and extra Edge Function reads for every admin tab.
--
-- Realtime still uses one WebSocket per app — typically cheaper than repeated HTTP
-- polling to Edge Functions.

CREATE TABLE IF NOT EXISTS public.app_order_pulse (
  id int PRIMARY KEY CHECK (id = 1),
  bump bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_order_pulse (id, bump, updated_at)
VALUES (1, 0, now())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_app_order_pulse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_order_pulse
  SET bump = bump + 1,
      updated_at = now()
  WHERE id = 1;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_kv_store_order_pulse_iu ON public.kv_store_16010b6f;
CREATE TRIGGER trg_kv_store_order_pulse_iu
  AFTER INSERT OR UPDATE ON public.kv_store_16010b6f
  FOR EACH ROW
  WHEN (NEW.key LIKE 'order:%')
  EXECUTE PROCEDURE public.bump_app_order_pulse();

DROP TRIGGER IF EXISTS trg_kv_store_order_pulse_del ON public.kv_store_16010b6f;
CREATE TRIGGER trg_kv_store_order_pulse_del
  AFTER DELETE ON public.kv_store_16010b6f
  FOR EACH ROW
  WHEN (OLD.key LIKE 'order:%')
  EXECUTE PROCEDURE public.bump_app_order_pulse();

ALTER TABLE public.app_order_pulse REPLICA IDENTITY FULL;

-- skipped Supabase Realtime publication block

-- skipped Supabase RLS enable
-- skipped Supabase RLS policy drop
-- skipped Supabase RLS policy

-- skipped Supabase role grant

-- ========================================
-- 20260521120000_vendor_application_realtime_pulse.sql
-- ========================================
-- Lightweight realtime heartbeat for vendor_application:* KV changes.
-- Admin badges subscribe to this single row (no PII) instead of waiting for
-- slow full-table kv_store Realtime or 60s HTTP polling.

CREATE TABLE IF NOT EXISTS public.app_vendor_application_pulse (
  id int PRIMARY KEY CHECK (id = 1),
  bump bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_vendor_application_pulse (id, bump, updated_at)
VALUES (1, 0, now())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bump_app_vendor_application_pulse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_vendor_application_pulse
  SET bump = bump + 1,
      updated_at = now()
  WHERE id = 1;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_kv_store_vendor_app_pulse_iu ON public.kv_store_16010b6f;
CREATE TRIGGER trg_kv_store_vendor_app_pulse_iu
  AFTER INSERT OR UPDATE ON public.kv_store_16010b6f
  FOR EACH ROW
  WHEN (NEW.key LIKE 'vendor_application:%')
  EXECUTE PROCEDURE public.bump_app_vendor_application_pulse();

DROP TRIGGER IF EXISTS trg_kv_store_vendor_app_pulse_del ON public.kv_store_16010b6f;
CREATE TRIGGER trg_kv_store_vendor_app_pulse_del
  AFTER DELETE ON public.kv_store_16010b6f
  FOR EACH ROW
  WHEN (OLD.key LIKE 'vendor_application:%')
  EXECUTE PROCEDURE public.bump_app_vendor_application_pulse();

ALTER TABLE public.app_vendor_application_pulse REPLICA IDENTITY FULL;

-- skipped Supabase Realtime publication block

-- skipped Supabase RLS enable
-- skipped Supabase RLS policy drop
-- skipped Supabase RLS policy

-- skipped Supabase role grant

-- ========================================
-- 20260521130000_vendor_storefront_uncategorized_filter.sql
-- ========================================
-- Vendor storefront: `category=uncategorized` means products with empty/missing category field.

CREATE OR REPLACE FUNCTION public.rpc_vendor_storefront_products_page(
  p_vendor_id text,
  p_vendor_business_name text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 24,
  p_category text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_resolve_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lim int := LEAST(GREATEST(COALESCE(p_page_size, 24), 1), 100);
  off int := (GREATEST(COALESCE(p_page, 1), 1) - 1) * lim;
  cat text := NULL;
  cat_uncategorized boolean := false;
  qpat text := NULL;
  slug text := NULL;
  result jsonb;
BEGIN
  IF p_category IS NOT NULL AND length(trim(p_category)) > 0 AND lower(trim(p_category)) <> 'all' THEN
    IF lower(trim(p_category)) IN ('uncategorized', '__uncategorized__') THEN
      cat_uncategorized := true;
    ELSE
      cat := lower(trim(p_category));
    END IF;
  END IF;
  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;
  IF p_resolve_slug IS NOT NULL AND length(trim(p_resolve_slug)) > 0 THEN
    slug := trim(p_resolve_slug);
  END IF;

  IF slug IS NOT NULL THEN
    WITH hit AS (
      SELECT value AS v
      FROM public.kv_store_16010b6f
      WHERE key LIKE 'product:%'
        AND lower(btrim(coalesce(value->>'status', ''))) = 'active'
        AND (
          value->>'vendorId' = p_vendor_id
          OR (p_vendor_business_name IS NOT NULL AND value->>'vendor' = p_vendor_business_name)
          OR value->>'vendor' = p_vendor_id
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(value->'selectedVendors', '[]'::jsonb)) t(x)
            WHERE t.x = p_vendor_id
              OR (p_vendor_business_name IS NOT NULL AND t.x = p_vendor_business_name)
          )
        )
        AND (
          lower(trim(coalesce(value->>'sku', ''))) = lower(slug)
          OR lower(trim(coalesce(value->>'id', ''))) = lower(slug)
          OR lower(
            regexp_replace(
              regexp_replace(trim(coalesce(value->>'name', '')), '[^\w\s-]', '', 'g'),
              '\s+',
              '-',
              'g'
            )
          ) = lower(slug)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(value->'variants', '[]'::jsonb)) var
            WHERE lower(trim(coalesce(var->>'sku', ''))) = lower(slug)
          )
        )
      LIMIT 1
    )
    SELECT jsonb_build_object(
      'products', coalesce((SELECT jsonb_agg(v) FROM hit), '[]'::jsonb),
      'total', (SELECT count(*)::bigint FROM hit),
      'page', 1,
      'pageSize', 1,
      'hasMore', false
    )
    INTO result;
    RETURN coalesce(result, jsonb_build_object('products', '[]'::jsonb, 'total', 0, 'page', 1, 'pageSize', 1, 'hasMore', false));
  END IF;

  WITH plat AS (
    SELECT value AS v
    FROM public.kv_store_16010b6f
    WHERE key LIKE 'product:%'
      AND lower(btrim(coalesce(value->>'status', ''))) = 'active'
      AND (
        value->>'vendorId' = p_vendor_id
        OR (p_vendor_business_name IS NOT NULL AND value->>'vendor' = p_vendor_business_name)
        OR value->>'vendor' = p_vendor_id
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(value->'selectedVendors', '[]'::jsonb)) t(x)
          WHERE t.x = p_vendor_id
            OR (p_vendor_business_name IS NOT NULL AND t.x = p_vendor_business_name)
        )
      )
      AND (
        (NOT cat_uncategorized AND cat IS NULL)
        OR (
          cat_uncategorized
          AND (
            length(btrim(coalesce(value->>'category', ''))) = 0
            OR lower(btrim(coalesce(value->>'category', ''))) = 'uncategorized'
          )
        )
        OR (cat IS NOT NULL AND lower(btrim(coalesce(value->>'category', ''))) = cat)
      )
      AND (qpat IS NULL OR lower(coalesce(value->>'name', '')) LIKE qpat OR lower(coalesce(value->>'sku', '')) LIKE qpat)
  ),
  tc AS (SELECT count(*)::bigint AS c FROM plat),
  sorted AS (
    SELECT v FROM plat
    ORDER BY coalesce(v->>'createDate', v->>'createdAt', '') DESC NULLS LAST, coalesce(v->>'name', '') ASC
  ),
  pagep AS (
    SELECT coalesce(jsonb_agg(v), '[]'::jsonb) AS j
    FROM (SELECT v FROM sorted LIMIT lim OFFSET off) z
  )
  SELECT jsonb_build_object(
    'products', (SELECT j FROM pagep),
    'total', (SELECT c FROM tc),
    'page', GREATEST(COALESCE(p_page, 1), 1),
    'pageSize', lim,
    'hasMore', (SELECT c FROM tc) > (off + lim)
  )
  INTO result;

  RETURN coalesce(result, jsonb_build_object('products', '[]'::jsonb, 'total', 0, 'page', 1, 'pageSize', lim, 'hasMore', false));
END;
$$;

-- ========================================
-- 20260616050000_app_read_model_tables.sql
-- ========================================
-- Add normalized SQL read-model tables beside the existing kv_store_16010b6f.
--
-- This migration is intentionally additive only:
-- - no existing KV data is moved or deleted
-- - no app endpoints are switched
-- - no realtime behavior changes
--
-- Follow-up migrations/jobs can backfill these tables from KV and dual-write new
-- mutations before read-heavy endpoints are moved to SQL pagination/aggregates.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.app_vendors (
  id text PRIMARY KEY,
  source_kv_key text UNIQUE,
  business_name text,
  display_name text,
  email text,
  phone text,
  status text,
  store_slug text,
  custom_domain text,
  commission_percent numeric(8, 4),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_customers (
  id text PRIMARY KEY,
  source_kv_key text UNIQUE,
  user_id text,
  name text,
  email text,
  phone text,
  status text,
  tier text,
  total_spent numeric(14, 2) NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_products (
  id text PRIMARY KEY,
  source_kv_key text UNIQUE,
  name text,
  sku text,
  vendor_id text,
  vendor_name text,
  selected_vendor_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  category text,
  status text,
  price numeric(14, 2),
  compare_at_price numeric(14, 2),
  inventory integer,
  track_quantity boolean,
  continue_selling_out_of_stock boolean,
  has_variants boolean NOT NULL DEFAULT false,
  sales_volume numeric(14, 2) NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- One row per product/variant SKU. This lets the app replace expensive
-- all-product SKU scans with indexed checks once dual-write/backfill is added.
CREATE TABLE IF NOT EXISTS public.app_product_skus (
  sku text PRIMARY KEY,
  product_id text NOT NULL REFERENCES public.app_products(id) ON DELETE CASCADE,
  variant_id text,
  normalized_sku text GENERATED ALWAYS AS (lower(btrim(sku))) STORED,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_orders (
  id text PRIMARY KEY,
  source_kv_key text UNIQUE,
  order_number text,
  customer_id text,
  customer_name text,
  email text,
  phone text,
  vendor_id text,
  vendor_name text,
  status text,
  payment_status text,
  shipping_status text,
  payment_method text,
  subtotal numeric(14, 2),
  discount numeric(14, 2),
  shipping_fee numeric(14, 2),
  total numeric(14, 2),
  currency text,
  inventory_deducted boolean,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_order_items (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES public.app_orders(id) ON DELETE CASCADE,
  line_index integer NOT NULL,
  product_id text,
  sku text,
  name text,
  vendor_id text,
  vendor_name text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(14, 2),
  line_total numeric(14, 2),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_index)
);

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id text PRIMARY KEY,
  source_kv_key text UNIQUE,
  user_id text,
  vendor_id text,
  kind text,
  title text,
  body text,
  is_read boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- Vendors
CREATE INDEX IF NOT EXISTS idx_app_vendors_status
  ON public.app_vendors (lower(coalesce(status, '')));

CREATE INDEX IF NOT EXISTS idx_app_vendors_store_slug
  ON public.app_vendors (lower(coalesce(store_slug, '')))
  WHERE store_slug IS NOT NULL AND btrim(store_slug) <> '';

CREATE INDEX IF NOT EXISTS idx_app_vendors_custom_domain
  ON public.app_vendors (lower(coalesce(custom_domain, '')))
  WHERE custom_domain IS NOT NULL AND btrim(custom_domain) <> '';

CREATE INDEX IF NOT EXISTS idx_app_vendors_name_trgm
  ON public.app_vendors
  USING gin (lower(coalesce(business_name, display_name, '')) gin_trgm_ops);

-- Customers
CREATE INDEX IF NOT EXISTS idx_app_customers_user_id
  ON public.app_customers (user_id)
  WHERE user_id IS NOT NULL AND btrim(user_id) <> '';

CREATE INDEX IF NOT EXISTS idx_app_customers_email
  ON public.app_customers (lower(coalesce(email, '')))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE INDEX IF NOT EXISTS idx_app_customers_phone
  ON public.app_customers (phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

CREATE INDEX IF NOT EXISTS idx_app_customers_status_tier
  ON public.app_customers (lower(coalesce(status, '')), lower(coalesce(tier, '')));

CREATE INDEX IF NOT EXISTS idx_app_customers_created_at
  ON public.app_customers (source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_customers_search_trgm
  ON public.app_customers
  USING gin (lower(coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')) gin_trgm_ops);

-- Products
CREATE INDEX IF NOT EXISTS idx_app_products_vendor_status_category
  ON public.app_products (
    vendor_id,
    lower(coalesce(status, '')),
    lower(coalesce(category, ''))
  );

CREATE INDEX IF NOT EXISTS idx_app_products_selected_vendor_ids
  ON public.app_products
  USING gin (selected_vendor_ids);

CREATE INDEX IF NOT EXISTS idx_app_products_platform_status_category
  ON public.app_products (lower(coalesce(status, '')), lower(coalesce(category, '')))
  WHERE vendor_id IS NULL OR btrim(vendor_id) = '' OR vendor_id = 'migoo';

CREATE INDEX IF NOT EXISTS idx_app_products_sku_lower
  ON public.app_products (lower(btrim(coalesce(sku, ''))))
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

CREATE INDEX IF NOT EXISTS idx_app_products_name_trgm
  ON public.app_products
  USING gin (lower(coalesce(name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_app_products_created_at
  ON public.app_products (source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_products_price
  ON public.app_products (price);

CREATE INDEX IF NOT EXISTS idx_app_products_sales_volume
  ON public.app_products (sales_volume DESC NULLS LAST);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_product_skus_normalized_unique
  ON public.app_product_skus (normalized_sku)
  WHERE normalized_sku <> '';

CREATE INDEX IF NOT EXISTS idx_app_product_skus_product_id
  ON public.app_product_skus (product_id);

-- Orders
CREATE INDEX IF NOT EXISTS idx_app_orders_order_number
  ON public.app_orders (lower(coalesce(order_number, '')))
  WHERE order_number IS NOT NULL AND btrim(order_number) <> '';

CREATE INDEX IF NOT EXISTS idx_app_orders_vendor_created_at
  ON public.app_orders (vendor_id, source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_orders_status_created_at
  ON public.app_orders (lower(coalesce(status, '')), source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_orders_payment_status_created_at
  ON public.app_orders (lower(coalesce(payment_status, '')), source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_orders_created_at
  ON public.app_orders (source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_orders_customer_lookup
  ON public.app_orders (lower(coalesce(email, '')), phone);

CREATE INDEX IF NOT EXISTS idx_app_orders_search_trgm
  ON public.app_orders
  USING gin (
    lower(
      coalesce(order_number, '') || ' ' ||
      coalesce(customer_name, '') || ' ' ||
      coalesce(email, '') || ' ' ||
      coalesce(phone, '')
    ) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_app_order_items_order_id
  ON public.app_order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_app_order_items_vendor_order
  ON public.app_order_items (vendor_id, order_id);

CREATE INDEX IF NOT EXISTS idx_app_order_items_product_id
  ON public.app_order_items (product_id)
  WHERE product_id IS NOT NULL AND btrim(product_id) <> '';

CREATE INDEX IF NOT EXISTS idx_app_order_items_sku_lower
  ON public.app_order_items (lower(btrim(coalesce(sku, ''))))
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

-- Notifications
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_read_created
  ON public.app_notifications (user_id, is_read, source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_notifications_vendor_read_created
  ON public.app_notifications (vendor_id, is_read, source_created_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_app_notifications_kind_created
  ON public.app_notifications (lower(coalesce(kind, '')), source_created_at DESC NULLS LAST);

-- Keep direct client access closed by default. Edge Functions use the service role
-- and can read/write through RLS; public API behavior remains controlled by Hono.
-- skipped Supabase RLS enable
-- skipped Supabase RLS enable
-- skipped Supabase RLS enable
-- skipped Supabase RLS enable
-- skipped Supabase RLS enable
-- skipped Supabase RLS enable
-- skipped Supabase RLS enable
COMMENT ON TABLE public.app_vendors IS 'Normalized read model for vendor KV documents; additive beside kv_store_16010b6f.';
COMMENT ON TABLE public.app_customers IS 'Normalized read model for customer KV documents and admin customer search.';
COMMENT ON TABLE public.app_products IS 'Normalized read model for product KV documents, storefront catalog, and admin product lists.';
COMMENT ON TABLE public.app_product_skus IS 'Indexed product and variant SKU lookup table for uniqueness checks.';
COMMENT ON TABLE public.app_orders IS 'Normalized read model for order KV documents and order analytics.';
COMMENT ON TABLE public.app_order_items IS 'Line-item read model for vendor order filtering and product analytics.';
COMMENT ON TABLE public.app_notifications IS 'Normalized read model for notification KV documents.';

-- ========================================
-- 20260616070000_backfill_app_read_models.sql
-- ========================================
-- Backfill normalized read-model tables from the existing KV documents.
--
-- This is safe to run after the app_read_model_tables migration and before any
-- endpoint reads are switched to SQL. KV remains the source of truth.

CREATE OR REPLACE FUNCTION public.app_read_model_num(raw text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN nullif(regexp_replace(coalesce(raw, ''), '[^0-9.-]', '', 'g'), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN nullif(regexp_replace(coalesce(raw, ''), '[^0-9.-]', '', 'g'), '')::numeric
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.app_read_model_int(raw text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN public.app_read_model_num(raw) IS NULL THEN NULL
    ELSE trunc(public.app_read_model_num(raw))::integer
  END;
$$;

CREATE OR REPLACE FUNCTION public.app_read_model_bool(raw text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(btrim(coalesce(raw, '')))
    WHEN 'true' THEN true
    WHEN 't' THEN true
    WHEN '1' THEN true
    WHEN 'yes' THEN true
    WHEN 'false' THEN false
    WHEN 'f' THEN false
    WHEN '0' THEN false
    WHEN 'no' THEN false
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.app_read_model_timestamptz(raw text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Vendors
INSERT INTO public.app_vendors (
  id,
  source_kv_key,
  business_name,
  display_name,
  email,
  phone,
  status,
  store_slug,
  custom_domain,
  commission_percent,
  raw,
  source_created_at,
  source_updated_at,
  synced_at
)
SELECT
  DISTINCT ON (coalesce(nullif(value->>'id', ''), substring(key from length('vendor:') + 1)))
  coalesce(nullif(value->>'id', ''), substring(key from length('vendor:') + 1)) AS id,
  key,
  nullif(coalesce(value->>'businessName', value->>'name'), ''),
  nullif(coalesce(value->>'displayName', value->>'name', value->>'businessName'), ''),
  nullif(value->>'email', ''),
  nullif(value->>'phone', ''),
  nullif(value->>'status', ''),
  nullif(coalesce(value->>'storeSlug', value->>'slug'), ''),
  nullif(coalesce(value->>'customDomain', value->>'domain'), ''),
  public.app_read_model_num(coalesce(value->>'commission', value->>'commissionRate')),
  value,
  public.app_read_model_timestamptz(coalesce(value->>'createdAt', value->>'createDate')),
  public.app_read_model_timestamptz(value->>'updatedAt'),
  now()
FROM public.kv_store_16010b6f
WHERE key LIKE 'vendor:%'
  AND key NOT LIKE 'vendor:audience:%'
  AND jsonb_typeof(value) = 'object'
  AND coalesce(nullif(value->>'id', ''), substring(key from length('vendor:') + 1)) <> ''
ORDER BY coalesce(nullif(value->>'id', ''), substring(key from length('vendor:') + 1)), key
ON CONFLICT (id) DO UPDATE SET
  source_kv_key = EXCLUDED.source_kv_key,
  business_name = EXCLUDED.business_name,
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  status = EXCLUDED.status,
  store_slug = EXCLUDED.store_slug,
  custom_domain = EXCLUDED.custom_domain,
  commission_percent = EXCLUDED.commission_percent,
  raw = EXCLUDED.raw,
  source_created_at = EXCLUDED.source_created_at,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- Customers. Exclude subdocuments like customer:{id}:cart/wishlist/addresses.
INSERT INTO public.app_customers (
  id,
  source_kv_key,
  user_id,
  name,
  email,
  phone,
  status,
  tier,
  total_spent,
  order_count,
  raw,
  source_created_at,
  source_updated_at,
  synced_at
)
SELECT
  DISTINCT ON (coalesce(nullif(value->>'id', ''), substring(key from length('customer:') + 1)))
  coalesce(nullif(value->>'id', ''), substring(key from length('customer:') + 1)) AS id,
  key,
  nullif(coalesce(value->>'userId', value->>'uid'), ''),
  nullif(coalesce(value->>'name', value->>'customerName', value->>'fullName'), ''),
  nullif(value->>'email', ''),
  nullif(value->>'phone', ''),
  nullif(value->>'status', ''),
  nullif(value->>'tier', ''),
  coalesce(public.app_read_model_num(coalesce(value->>'totalSpent', value->>'lifetimeValue')), 0),
  coalesce(public.app_read_model_int(coalesce(value->>'orderCount', value->>'totalOrders')), 0),
  value,
  public.app_read_model_timestamptz(coalesce(value->>'createdAt', value->>'joinDate')),
  public.app_read_model_timestamptz(value->>'updatedAt'),
  now()
FROM public.kv_store_16010b6f
WHERE key LIKE 'customer:%'
  AND key !~ '^customer:[^:]+:(cart|wishlist|addresses)$'
  AND jsonb_typeof(value) = 'object'
  AND coalesce(nullif(value->>'id', ''), substring(key from length('customer:') + 1)) <> ''
ORDER BY coalesce(nullif(value->>'id', ''), substring(key from length('customer:') + 1)), key
ON CONFLICT (id) DO UPDATE SET
  source_kv_key = EXCLUDED.source_kv_key,
  user_id = EXCLUDED.user_id,
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  status = EXCLUDED.status,
  tier = EXCLUDED.tier,
  total_spent = EXCLUDED.total_spent,
  order_count = EXCLUDED.order_count,
  raw = EXCLUDED.raw,
  source_created_at = EXCLUDED.source_created_at,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- Registered vendor-audience rows may not have a canonical customer:* document yet.
-- Store them as customer read-model rows too so SQL-backed admin customers keeps parity
-- with the legacy mergeSystemCustomerSources() behavior.
WITH audience_rows AS (
  SELECT
    aud.value AS aud
  FROM public.kv_store_16010b6f kv
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value
      ELSE '[]'::jsonb
    END
  ) AS aud(value)
  WHERE kv.key LIKE 'vendor:audience:%'
    AND jsonb_typeof(aud.value) = 'object'
),
audience_deduped AS (
  SELECT DISTINCT ON (
    coalesce(
      nullif(aud->>'userId', ''),
      'email:' || lower(nullif(aud->>'email', '')),
      'phone:' || nullif(aud->>'phone', '')
    )
  )
    coalesce(
      nullif(aud->>'userId', ''),
      'email:' || lower(nullif(aud->>'email', '')),
      'phone:' || nullif(aud->>'phone', '')
    ) AS id,
    aud
  FROM audience_rows
  WHERE coalesce(
      nullif(aud->>'userId', ''),
      'email:' || lower(nullif(aud->>'email', '')),
      'phone:' || nullif(aud->>'phone', '')
    ) IS NOT NULL
  ORDER BY
    coalesce(
      nullif(aud->>'userId', ''),
      'email:' || lower(nullif(aud->>'email', '')),
      'phone:' || nullif(aud->>'phone', '')
    ),
    coalesce(aud->>'lastSeenAt', aud->>'firstSeenAt', '') DESC
)
INSERT INTO public.app_customers (
  id,
  user_id,
  name,
  email,
  phone,
  status,
  tier,
  total_spent,
  order_count,
  raw,
  source_created_at,
  source_updated_at,
  synced_at
)
SELECT
  id,
  nullif(aud->>'userId', ''),
  nullif(aud->>'name', ''),
  nullif(aud->>'email', ''),
  nullif(aud->>'phone', ''),
  'active',
  null,
  0,
  0,
  aud,
  public.app_read_model_timestamptz(aud->>'firstSeenAt'),
  public.app_read_model_timestamptz(aud->>'lastSeenAt'),
  now()
FROM audience_deduped
ON CONFLICT (id) DO UPDATE SET
  user_id = coalesce(public.app_customers.user_id, EXCLUDED.user_id),
  name = coalesce(public.app_customers.name, EXCLUDED.name),
  email = coalesce(public.app_customers.email, EXCLUDED.email),
  phone = coalesce(public.app_customers.phone, EXCLUDED.phone),
  status = coalesce(public.app_customers.status, EXCLUDED.status),
  raw = CASE
    WHEN public.app_customers.raw = '{}'::jsonb THEN EXCLUDED.raw
    ELSE public.app_customers.raw
  END,
  source_created_at = coalesce(public.app_customers.source_created_at, EXCLUDED.source_created_at),
  source_updated_at = coalesce(
    greatest(public.app_customers.source_updated_at, EXCLUDED.source_updated_at),
    public.app_customers.source_updated_at,
    EXCLUDED.source_updated_at
  ),
  synced_at = now();

-- Products
INSERT INTO public.app_products (
  id,
  source_kv_key,
  name,
  sku,
  vendor_id,
  vendor_name,
  selected_vendor_ids,
  category,
  status,
  price,
  compare_at_price,
  inventory,
  track_quantity,
  continue_selling_out_of_stock,
  has_variants,
  sales_volume,
  raw,
  source_created_at,
  source_updated_at,
  synced_at
)
SELECT
  DISTINCT ON (coalesce(nullif(value->>'id', ''), substring(key from length('product:') + 1)))
  coalesce(nullif(value->>'id', ''), substring(key from length('product:') + 1)) AS id,
  key,
  nullif(coalesce(value->>'name', value->>'title'), ''),
  nullif(value->>'sku', ''),
  nullif(value->>'vendorId', ''),
  nullif(value->>'vendor', ''),
  coalesce(
    ARRAY(
      SELECT DISTINCT btrim(x)
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(value->'selectedVendors') = 'array' THEN value->'selectedVendors'
          ELSE '[]'::jsonb
        END
      ) AS t(x)
      WHERE btrim(x) <> ''
    ),
    ARRAY[]::text[]
  ),
  nullif(value->>'category', ''),
  nullif(value->>'status', ''),
  public.app_read_model_num(value->>'price'),
  public.app_read_model_num(value->>'compareAtPrice'),
  public.app_read_model_int(coalesce(value->>'inventory', value->>'stock')),
  public.app_read_model_bool(value->>'trackQuantity'),
  public.app_read_model_bool(value->>'continueSellingOutOfStock'),
  coalesce(public.app_read_model_bool(value->>'hasVariants'), false),
  coalesce(public.app_read_model_num(value->>'salesVolume'), 0),
  value,
  public.app_read_model_timestamptz(coalesce(value->>'createdAt', value->>'createDate')),
  public.app_read_model_timestamptz(value->>'updatedAt'),
  now()
FROM public.kv_store_16010b6f
WHERE key LIKE 'product:%'
  AND jsonb_typeof(value) = 'object'
  AND coalesce(nullif(value->>'id', ''), substring(key from length('product:') + 1)) <> ''
ORDER BY coalesce(nullif(value->>'id', ''), substring(key from length('product:') + 1)), key
ON CONFLICT (id) DO UPDATE SET
  source_kv_key = EXCLUDED.source_kv_key,
  name = EXCLUDED.name,
  sku = EXCLUDED.sku,
  vendor_id = EXCLUDED.vendor_id,
  vendor_name = EXCLUDED.vendor_name,
  selected_vendor_ids = EXCLUDED.selected_vendor_ids,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  price = EXCLUDED.price,
  compare_at_price = EXCLUDED.compare_at_price,
  inventory = EXCLUDED.inventory,
  track_quantity = EXCLUDED.track_quantity,
  continue_selling_out_of_stock = EXCLUDED.continue_selling_out_of_stock,
  has_variants = EXCLUDED.has_variants,
  sales_volume = EXCLUDED.sales_volume,
  raw = EXCLUDED.raw,
  source_created_at = EXCLUDED.source_created_at,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- Product and variant SKUs. Canonicalize to lower-case to avoid duplicate-case conflicts.
WITH sku_candidates AS (
  SELECT
    coalesce(nullif(kv.value->>'id', ''), substring(kv.key from length('product:') + 1)) AS product_id,
    lower(btrim(kv.value->>'sku')) AS sku,
    NULL::text AS variant_id,
    jsonb_build_object('source', 'product', 'rawSku', kv.value->>'sku') AS raw
  FROM public.kv_store_16010b6f kv
  WHERE kv.key LIKE 'product:%'
    AND jsonb_typeof(kv.value) = 'object'
    AND btrim(coalesce(kv.value->>'sku', '')) <> ''

  UNION ALL

  SELECT
    coalesce(nullif(kv.value->>'id', ''), substring(kv.key from length('product:') + 1)) AS product_id,
    lower(btrim(variant.value->>'sku')) AS sku,
    nullif(coalesce(variant.value->>'id', variant.value->>'variantId'), '') AS variant_id,
    variant.value AS raw
  FROM public.kv_store_16010b6f kv
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(kv.value->'variants') = 'array' THEN kv.value->'variants'
      ELSE '[]'::jsonb
    END
  ) AS variant(value)
  WHERE kv.key LIKE 'product:%'
    AND jsonb_typeof(kv.value) = 'object'
    AND btrim(coalesce(variant.value->>'sku', '')) <> ''
),
deduped_skus AS (
  SELECT DISTINCT ON (sku)
    sku,
    product_id,
    variant_id,
    raw
  FROM sku_candidates
  WHERE sku <> ''
    AND product_id IN (SELECT id FROM public.app_products)
  ORDER BY sku, product_id, variant_id NULLS FIRST
)
INSERT INTO public.app_product_skus (
  sku,
  product_id,
  variant_id,
  raw,
  synced_at
)
SELECT
  sku,
  product_id,
  variant_id,
  raw,
  now()
FROM deduped_skus d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.app_product_skus existing
  WHERE existing.normalized_sku = d.sku
);

-- Orders
INSERT INTO public.app_orders (
  id,
  source_kv_key,
  order_number,
  customer_id,
  customer_name,
  email,
  phone,
  vendor_id,
  vendor_name,
  status,
  payment_status,
  shipping_status,
  payment_method,
  subtotal,
  discount,
  shipping_fee,
  total,
  currency,
  inventory_deducted,
  raw,
  source_created_at,
  source_updated_at,
  synced_at
)
SELECT
  DISTINCT ON (coalesce(nullif(value->>'id', ''), substring(key from length('order:') + 1)))
  coalesce(nullif(value->>'id', ''), substring(key from length('order:') + 1)) AS id,
  key,
  nullif(value->>'orderNumber', ''),
  nullif(coalesce(value->>'customerId', value->>'userId'), ''),
  nullif(coalesce(value->>'customerName', value->>'customer'), ''),
  nullif(value->>'email', ''),
  nullif(value->>'phone', ''),
  nullif(value->>'vendorId', ''),
  nullif(coalesce(value->>'vendorName', value->>'vendor'), ''),
  nullif(value->>'status', ''),
  nullif(value->>'paymentStatus', ''),
  nullif(value->>'shippingStatus', ''),
  nullif(value->>'paymentMethod', ''),
  public.app_read_model_num(value->>'subtotal'),
  public.app_read_model_num(value->>'discount'),
  public.app_read_model_num(coalesce(value->>'shippingFee', value->>'shipping')),
  public.app_read_model_num(coalesce(value->>'total', value->>'amount')),
  nullif(value->>'currency', ''),
  public.app_read_model_bool(value->>'inventoryDeducted'),
  value,
  public.app_read_model_timestamptz(coalesce(value->>'createdAt', value->>'date')),
  public.app_read_model_timestamptz(value->>'updatedAt'),
  now()
FROM public.kv_store_16010b6f
WHERE key LIKE 'order:%'
  AND jsonb_typeof(value) = 'object'
  AND coalesce(nullif(value->>'id', ''), substring(key from length('order:') + 1)) <> ''
ORDER BY coalesce(nullif(value->>'id', ''), substring(key from length('order:') + 1)), key
ON CONFLICT (id) DO UPDATE SET
  source_kv_key = EXCLUDED.source_kv_key,
  order_number = EXCLUDED.order_number,
  customer_id = EXCLUDED.customer_id,
  customer_name = EXCLUDED.customer_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  vendor_id = EXCLUDED.vendor_id,
  vendor_name = EXCLUDED.vendor_name,
  status = EXCLUDED.status,
  payment_status = EXCLUDED.payment_status,
  shipping_status = EXCLUDED.shipping_status,
  payment_method = EXCLUDED.payment_method,
  subtotal = EXCLUDED.subtotal,
  discount = EXCLUDED.discount,
  shipping_fee = EXCLUDED.shipping_fee,
  total = EXCLUDED.total,
  currency = EXCLUDED.currency,
  inventory_deducted = EXCLUDED.inventory_deducted,
  raw = EXCLUDED.raw,
  source_created_at = EXCLUDED.source_created_at,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- Order line items
INSERT INTO public.app_order_items (
  order_id,
  line_index,
  product_id,
  sku,
  name,
  vendor_id,
  vendor_name,
  quantity,
  unit_price,
  line_total,
  raw,
  synced_at
)
SELECT
  coalesce(nullif(kv.value->>'id', ''), substring(kv.key from length('order:') + 1)) AS order_id,
  (item.ordinality - 1)::integer AS line_index,
  nullif(coalesce(item.value->>'productId', item.value->>'product_id', item.value->>'id'), ''),
  nullif(item.value->>'sku', ''),
  nullif(coalesce(item.value->>'name', item.value->>'title'), ''),
  nullif(coalesce(item.value->>'vendorId', item.value->>'vendor_id', item.value->>'vendor', kv.value->>'vendorId', kv.value->>'vendor'), ''),
  nullif(coalesce(item.value->>'vendorName', item.value->>'vendor', kv.value->>'vendorName', kv.value->>'vendor'), ''),
  coalesce(public.app_read_model_int(item.value->>'quantity'), 1),
  public.app_read_model_num(coalesce(item.value->>'price', item.value->>'unitPrice')),
  coalesce(
    public.app_read_model_num(coalesce(item.value->>'total', item.value->>'lineTotal')),
    public.app_read_model_num(coalesce(item.value->>'price', item.value->>'unitPrice')) * coalesce(public.app_read_model_int(item.value->>'quantity'), 1)
  ),
  item.value,
  now()
FROM public.kv_store_16010b6f kv
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(kv.value->'items') = 'array' THEN kv.value->'items'
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS item(value, ordinality)
WHERE kv.key LIKE 'order:%'
  AND jsonb_typeof(kv.value) = 'object'
  AND coalesce(nullif(kv.value->>'id', ''), substring(kv.key from length('order:') + 1)) IN (
    SELECT id FROM public.app_orders
  )
  AND kv.key = (
    SELECT source_kv_key
    FROM public.app_orders ao
    WHERE ao.id = coalesce(nullif(kv.value->>'id', ''), substring(kv.key from length('order:') + 1))
  )
ON CONFLICT (order_id, line_index) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  sku = EXCLUDED.sku,
  name = EXCLUDED.name,
  vendor_id = EXCLUDED.vendor_id,
  vendor_name = EXCLUDED.vendor_name,
  quantity = EXCLUDED.quantity,
  unit_price = EXCLUDED.unit_price,
  line_total = EXCLUDED.line_total,
  raw = EXCLUDED.raw,
  synced_at = now();

-- Notifications
INSERT INTO public.app_notifications (
  id,
  source_kv_key,
  user_id,
  vendor_id,
  kind,
  title,
  body,
  is_read,
  raw,
  source_created_at,
  source_updated_at,
  synced_at
)
SELECT
  DISTINCT ON (coalesce(nullif(value->>'id', ''), substring(key from length('notification:') + 1)))
  coalesce(nullif(value->>'id', ''), substring(key from length('notification:') + 1)) AS id,
  key,
  nullif(coalesce(value->>'userId', value->>'uid'), ''),
  nullif(value->>'vendorId', ''),
  nullif(coalesce(value->>'kind', value->>'type'), ''),
  nullif(value->>'title', ''),
  nullif(coalesce(value->>'body', value->>'message', value->>'description'), ''),
  coalesce(public.app_read_model_bool(coalesce(value->>'isRead', value->>'read')), false),
  value,
  public.app_read_model_timestamptz(coalesce(value->>'createdAt', value->>'timestamp')),
  public.app_read_model_timestamptz(value->>'updatedAt'),
  now()
FROM public.kv_store_16010b6f
WHERE key LIKE 'notification:%'
  AND jsonb_typeof(value) = 'object'
  AND coalesce(nullif(value->>'id', ''), substring(key from length('notification:') + 1)) <> ''
ORDER BY coalesce(nullif(value->>'id', ''), substring(key from length('notification:') + 1)), key
ON CONFLICT (id) DO UPDATE SET
  source_kv_key = EXCLUDED.source_kv_key,
  user_id = EXCLUDED.user_id,
  vendor_id = EXCLUDED.vendor_id,
  kind = EXCLUDED.kind,
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  is_read = EXCLUDED.is_read,
  raw = EXCLUDED.raw,
  source_created_at = EXCLUDED.source_created_at,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- ========================================
-- 20260616073000_admin_orders_read_model_rpc.sql
-- ========================================
-- SQL-backed admin orders page from app_orders.
-- Edge uses this when available and falls back to KV scans when not applied yet.

CREATE OR REPLACE FUNCTION public.rpc_admin_orders_page(
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 20,
  p_q text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_payment text DEFAULT 'all',
  p_vendor text DEFAULT 'all',
  p_date_from text DEFAULT NULL,
  p_date_to text DEFAULT NULL,
  p_sort text DEFAULT 'newest'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  page_num int := GREATEST(COALESCE(p_page, 1), 1);
  page_size int := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  off int := (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  qpat text := NULL;
  status_filter text := lower(trim(coalesce(nullif(p_status, ''), 'all')));
  payment_filter text := lower(trim(coalesce(nullif(p_payment, ''), 'all')));
  vendor_filter text := trim(coalesce(nullif(p_vendor, ''), 'all'));
  sort_dir text := CASE WHEN lower(trim(coalesce(p_sort, 'newest'))) = 'oldest' THEN 'ASC' ELSE 'DESC' END;
  from_ts timestamptz := public.app_read_model_timestamptz(p_date_from);
  to_ts timestamptz := public.app_read_model_timestamptz(
    CASE
      WHEN p_date_to IS NULL OR btrim(p_date_to) = '' THEN NULL
      WHEN p_date_to ~ 'T' THEN p_date_to
      ELSE p_date_to || 'T23:59:59.999Z'
    END
  );
  result jsonb;
BEGIN
  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;

  EXECUTE format($sql$
    WITH filtered AS (
      SELECT
        id,
        raw,
        coalesce(nullif(vendor_name, ''), 'SECURE Store') AS vendor_label,
        synced_at,
        coalesce(source_created_at, source_updated_at, synced_at) AS order_ts,
        coalesce(total, 0) AS total_num,
        coalesce(status, 'pending') AS status_value,
        coalesce(payment_status, 'pending') AS payment_status_value
      FROM public.app_orders
      WHERE ($1::text = 'all' OR lower(coalesce(status, '')) = $1::text)
        AND ($2::text = 'all' OR lower(coalesce(payment_status, '')) = $2::text)
        AND (
          $3::text = 'all'
          OR coalesce(nullif(vendor_name, ''), 'SECURE Store') = $3::text
        )
        AND ($4::timestamptz IS NULL OR coalesce(source_created_at, source_updated_at, synced_at) >= $4::timestamptz)
        AND ($5::timestamptz IS NULL OR coalesce(source_created_at, source_updated_at, synced_at) <= $5::timestamptz)
        AND (
          $6::text IS NULL
          OR lower(coalesce(order_number, '')) LIKE $6::text
          OR lower(coalesce(customer_name, '')) LIKE $6::text
          OR lower(coalesce(email, '')) LIKE $6::text
          OR lower(coalesce(phone, '')) LIKE $6::text
          OR lower(id) LIKE $6::text
        )
    ),
    counts AS (
      SELECT
        count(*)::bigint AS filtered_count,
        coalesce(sum(total_num) FILTER (WHERE lower(status_value) <> 'cancelled'), 0) AS filtered_total_revenue,
        count(*) FILTER (WHERE lower(status_value) = 'pending')::bigint AS pending_count,
        count(*) FILTER (WHERE lower(status_value) = 'processing')::bigint AS processing_count,
        count(*) FILTER (WHERE lower(status_value) = 'fulfilled')::bigint AS fulfilled_count,
        count(*) FILTER (WHERE lower(status_value) = 'cancelled')::bigint AS cancelled_count
      FROM filtered
    ),
    read_model_total AS (
      SELECT count(*)::bigint AS c FROM public.app_orders
    ),
    vendor_list AS (
      SELECT coalesce(jsonb_agg(vendor_label ORDER BY vendor_label), '[]'::jsonb) AS unique_vendors
      FROM (
        SELECT DISTINCT vendor_label
        FROM filtered
      ) s
    ),
    vendor_revenue AS (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object('vendor', vendor_label, 'revenue', revenue)
          ORDER BY revenue DESC
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT vendor_label, coalesce(sum(total_num), 0) AS revenue
        FROM filtered
        WHERE lower(status_value) <> 'cancelled'
        GROUP BY vendor_label
      ) s
    ),
    sorted AS (
      SELECT *
      FROM filtered
      ORDER BY order_ts %s NULLS LAST, id %s
      LIMIT %s OFFSET %s
    ),
    page_rows AS (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'orderNumber', coalesce(raw->>'orderNumber', ''),
            'customer', coalesce(raw->>'customer', raw->>'customerName', ''),
            'email', coalesce(raw->>'email', ''),
            'phone', coalesce(raw->>'phone', ''),
            'vendor', vendor_label,
            'status', status_value,
            'paymentStatus', payment_status_value,
            'shippingStatus', coalesce(raw->>'shippingStatus', 'pending'),
            'paymentMethod', coalesce(raw->>'paymentMethod', ''),
            'total', total_num,
            'items', coalesce(raw->'items', '[]'::jsonb),
            'shippingAddress', coalesce(raw->>'shippingAddress', ''),
            'trackingNumber', raw->>'trackingNumber',
            'notes', raw->>'notes',
            'deliveryService', raw->>'deliveryService',
            'deliveryServiceLogo', raw->>'deliveryServiceLogo',
            'inventoryDeducted', coalesce(public.app_read_model_bool(raw->>'inventoryDeducted'), false),
            'refundStatus', lower(trim(coalesce(raw#>>'{kpay,refund,status}', ''))),
            'refundRequestNo', trim(coalesce(raw#>>'{kpay,refund,refundRequestNo}', '')),
            'refundAmount', coalesce(public.app_read_model_num(raw#>>'{kpay,refund,amount}'), 0),
            'refundedAt', trim(coalesce(raw#>>'{kpay,refund,refundedAt}', raw#>>'{kpay,refund,failedAt}', '')),
            'date', coalesce(raw->>'date', raw->>'createdAt', synced_at::text),
            'createdAt', coalesce(raw->>'createdAt', synced_at::text),
            'updatedAt', coalesce(raw->>'updatedAt', synced_at::text)
          )
          ORDER BY order_ts %s NULLS LAST, id %s
        ),
        '[]'::jsonb
      ) AS orders
      FROM sorted
    )
    SELECT jsonb_build_object(
      'orders', (SELECT orders FROM page_rows),
      'total', (SELECT filtered_count FROM counts),
      'readModelRows', (SELECT c FROM read_model_total),
      'page', %s,
      'pageSize', %s,
      'hasMore', ((SELECT filtered_count FROM counts) > (%s + %s)),
      'aggregates', jsonb_build_object(
        'filteredCount', (SELECT filtered_count FROM counts),
        'filteredTotalRevenue', (SELECT filtered_total_revenue FROM counts),
        'filteredAvgOrderValue',
          CASE
            WHEN (SELECT filtered_count FROM counts) > 0
            THEN (SELECT filtered_total_revenue FROM counts) / (SELECT filtered_count FROM counts)
            ELSE 0
          END,
        'statusBreakdown', jsonb_build_object(
          'pending', (SELECT pending_count FROM counts),
          'processing', (SELECT processing_count FROM counts),
          'fulfilled', (SELECT fulfilled_count FROM counts),
          'cancelled', (SELECT cancelled_count FROM counts)
        ),
        'uniqueVendors', (SELECT unique_vendors FROM vendor_list),
        'vendorRevenue', (SELECT rows FROM vendor_revenue)
      )
    )
  $sql$, sort_dir, sort_dir, page_size, off, sort_dir, sort_dir, page_num, page_size, off, page_size)
  USING status_filter, payment_filter, vendor_filter, from_ts, to_ts, qpat
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_orders_page IS 'Paged admin orders list backed by app_orders read model; preserves Edge API response shape.';

-- ========================================
-- 20260616080000_vendor_orders_read_model_rpc.sql
-- ========================================
-- SQL-backed vendor orders page from app_orders + app_order_items.
-- Edge uses this when available and falls back to the current KV scan when not applied/backfilled.

CREATE OR REPLACE FUNCTION public.rpc_vendor_orders_page(
  p_vendor_ids text[],
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 20,
  p_q text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_payment text DEFAULT 'all',
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL,
  p_sort text DEFAULT 'newest'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  page_num int := GREATEST(COALESCE(p_page, 1), 1);
  page_size int := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  off int := (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  qpat text := NULL;
  status_filter text := lower(trim(coalesce(nullif(p_status, ''), 'all')));
  payment_filter text := lower(trim(coalesce(nullif(p_payment, ''), 'all')));
  vendor_ids text[] := coalesce(p_vendor_ids, ARRAY[]::text[]);
  sort_dir text := CASE WHEN lower(trim(coalesce(p_sort, 'newest'))) = 'oldest' THEN 'ASC' ELSE 'DESC' END;
  from_ts timestamptz := public.app_read_model_timestamptz(p_from);
  to_ts timestamptz := public.app_read_model_timestamptz(p_to);
  result jsonb;
BEGIN
  IF cardinality(vendor_ids) = 0 THEN
    RETURN jsonb_build_object(
      'orders', '[]'::jsonb,
      'total', 0,
      'readModelRows', (SELECT count(*) FROM public.app_orders),
      'page', page_num,
      'pageSize', page_size,
      'hasMore', false,
      'summary', jsonb_build_object('totalRevenue', 0, 'pending', 0, 'processing', 0, 'fulfilled', 0, 'cancelled', 0)
    );
  END IF;

  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;

  EXECUTE format($sql$
    WITH matching_orders AS (
      SELECT DISTINCT o.id
      FROM public.app_orders o
      LEFT JOIN public.app_order_items i ON i.order_id = o.id
      WHERE (
          coalesce(o.vendor_id, '') = ANY($1::text[])
          OR coalesce(o.vendor_name, '') = ANY($1::text[])
          OR coalesce(i.vendor_id, '') = ANY($1::text[])
          OR coalesce(i.vendor_name, '') = ANY($1::text[])
        )
    ),
    base AS (
      SELECT
        o.*,
        coalesce(o.source_created_at, o.source_updated_at, o.synced_at) AS order_ts,
        coalesce(o.status, 'pending') AS status_value,
        coalesce(o.payment_status, 'pending') AS payment_status_value
      FROM public.app_orders o
      JOIN matching_orders mo ON mo.id = o.id
      WHERE ($2::text = 'all' OR lower(coalesce(o.status, '')) = $2::text)
        AND ($3::text = 'all' OR lower(coalesce(o.payment_status, '')) = $3::text)
        AND ($4::timestamptz IS NULL OR coalesce(o.source_created_at, o.source_updated_at, o.synced_at) >= $4::timestamptz)
        AND ($5::timestamptz IS NULL OR coalesce(o.source_created_at, o.source_updated_at, o.synced_at) <= $5::timestamptz)
        AND (
          $6::text IS NULL
          OR lower(coalesce(o.order_number, '')) LIKE $6::text
          OR lower(coalesce(o.customer_name, '')) LIKE $6::text
          OR lower(coalesce(o.email, '')) LIKE $6::text
          OR lower(o.id) LIKE $6::text
        )
    ),
    with_vendor_lines AS (
      SELECT
        b.*,
        coalesce(line_agg.vendor_line_count, 0) AS vendor_line_count,
        coalesce(line_agg.all_line_count, 0) AS all_line_count,
        coalesce(line_agg.vendor_items, '[]'::jsonb) AS vendor_items,
        coalesce(line_agg.all_items, '[]'::jsonb) AS all_items,
        coalesce(line_agg.vendor_lines_subtotal, 0) AS vendor_lines_subtotal
      FROM base b
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS all_line_count,
          count(*) FILTER (
            WHERE coalesce(i.vendor_id, '') = ANY($1::text[])
               OR coalesce(i.vendor_name, '') = ANY($1::text[])
          )::int AS vendor_line_count,
          coalesce(
            jsonb_agg(i.raw ORDER BY i.line_index) FILTER (
              WHERE coalesce(i.vendor_id, '') = ANY($1::text[])
                 OR coalesce(i.vendor_name, '') = ANY($1::text[])
            ),
            '[]'::jsonb
          ) AS vendor_items,
          coalesce(jsonb_agg(i.raw ORDER BY i.line_index), '[]'::jsonb) AS all_items,
          coalesce(
            sum(coalesce(i.line_total, coalesce(i.unit_price, 0) * coalesce(i.quantity, 1))) FILTER (
              WHERE coalesce(i.vendor_id, '') = ANY($1::text[])
                 OR coalesce(i.vendor_name, '') = ANY($1::text[])
            ),
            0
          ) AS vendor_lines_subtotal
        FROM public.app_order_items i
        WHERE i.order_id = b.id
      ) line_agg ON true
    ),
    shaped AS (
      SELECT
        *,
        CASE
          WHEN all_line_count > 0 AND vendor_line_count = all_line_count THEN coalesce(total, 0)
          WHEN vendor_line_count > 0 AND coalesce(subtotal, 0) > 0 AND coalesce(discount, 0) > 0 AND vendor_lines_subtotal > 0
            THEN greatest(0, round((vendor_lines_subtotal - ((coalesce(discount, 0) * vendor_lines_subtotal) / subtotal))::numeric, 2))
          WHEN vendor_line_count > 0 THEN vendor_lines_subtotal
          ELSE coalesce(total, 0)
        END AS vendor_display_total,
        CASE
          WHEN vendor_line_count > 0 THEN vendor_items
          ELSE all_items
        END AS display_items
      FROM with_vendor_lines
    ),
    counts AS (
      SELECT
        count(*)::bigint AS filtered_count,
        coalesce(sum(vendor_display_total) FILTER (WHERE lower(status_value) <> 'cancelled'), 0) AS total_revenue,
        count(*) FILTER (WHERE lower(status_value) = 'pending')::bigint AS pending_count,
        count(*) FILTER (WHERE lower(status_value) = 'processing')::bigint AS processing_count,
        count(*) FILTER (WHERE lower(status_value) = 'fulfilled')::bigint AS fulfilled_count,
        count(*) FILTER (WHERE lower(status_value) = 'cancelled')::bigint AS cancelled_count
      FROM shaped
    ),
    read_model_total AS (
      SELECT count(*)::bigint AS c FROM public.app_orders
    ),
    sorted AS (
      SELECT *
      FROM shaped
      ORDER BY order_ts %s NULLS LAST, id %s
      LIMIT %s OFFSET %s
    ),
    page_rows AS (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'orderNumber', raw->>'orderNumber',
            'customer', coalesce(raw->>'customer', raw->>'customerName'),
            'customerName', coalesce(raw->>'customerName', raw->>'customer'),
            'email', raw->>'email',
            'phone', raw->>'phone',
            'status', status_value,
            'paymentStatus', payment_status_value,
            'shippingStatus', coalesce(raw->>'shippingStatus', 'pending'),
            'paymentMethod', coalesce(raw->>'paymentMethod', ''),
            'kpay', raw->'kpay',
            'total', vendor_display_total,
            'subtotal', coalesce(subtotal, vendor_lines_subtotal),
            'discount', coalesce(discount, 0),
            'date', coalesce(raw->>'date', raw->>'createdAt'),
            'createdAt', raw->>'createdAt',
            'items', display_items,
            'shippingAddress', coalesce(raw->>'shippingAddress', ''),
            'trackingNumber', coalesce(raw->>'trackingNumber', ''),
            'notes', coalesce(raw->>'notes', ''),
            'deliveryService', coalesce(raw->>'deliveryService', ''),
            'deliveryServiceLogo', coalesce(raw->>'deliveryServiceLogo', ''),
            'inventoryDeducted', public.app_read_model_bool(raw->>'inventoryDeducted')
          )
          ORDER BY order_ts %s NULLS LAST, id %s
        ),
        '[]'::jsonb
      ) AS orders
      FROM sorted
    )
    SELECT jsonb_build_object(
      'orders', (SELECT orders FROM page_rows),
      'total', (SELECT filtered_count FROM counts),
      'readModelRows', (SELECT c FROM read_model_total),
      'page', %s,
      'pageSize', %s,
      'hasMore', ((SELECT filtered_count FROM counts) > (%s + %s)),
      'summary', jsonb_build_object(
        'totalRevenue', (SELECT total_revenue FROM counts),
        'pending', (SELECT pending_count FROM counts),
        'processing', (SELECT processing_count FROM counts),
        'fulfilled', (SELECT fulfilled_count FROM counts),
        'cancelled', (SELECT cancelled_count FROM counts)
      )
    )
  $sql$, sort_dir, sort_dir, page_size, off, sort_dir, sort_dir, page_num, page_size, off, page_size)
  USING vendor_ids, status_filter, payment_filter, from_ts, to_ts, qpat
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_vendor_orders_page IS 'Paged vendor-admin orders list backed by app_orders/app_order_items; preserves Edge API response shape.';

-- ========================================
-- 20260616083000_customers_finances_read_model_rpcs.sql
-- ========================================
-- SQL-backed customers page + finances analytics from app_* read models.
-- Edge falls back to KV paths when these functions are unavailable or not backfilled.

CREATE OR REPLACE FUNCTION public.app_customer_segment(raw jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH s AS (
    SELECT
      coalesce(public.app_read_model_num(raw#>>'{rfmScore,recency}'), 0) AS recency,
      coalesce(public.app_read_model_num(raw#>>'{rfmScore,frequency}'), 0) AS frequency,
      coalesce(public.app_read_model_num(raw#>>'{rfmScore,monetary}'), 0) AS monetary
  )
  SELECT CASE
    WHEN jsonb_typeof(raw->'rfmScore') IS DISTINCT FROM 'object' THEN 'unknown'
    WHEN (recency + frequency + monetary) >= 13 THEN 'champions'
    WHEN (recency + frequency + monetary) >= 10 AND recency >= 4 THEN 'loyal'
    WHEN (recency + frequency + monetary) >= 8 AND recency >= 3 THEN 'potential-loyalist'
    WHEN (recency + frequency + monetary) >= 6 AND recency <= 2 THEN 'at-risk'
    WHEN frequency >= 4 AND recency <= 2 THEN 'cant-lose'
    WHEN (recency + frequency + monetary) <= 6 THEN 'hibernating'
    ELSE 'need-attention'
  END
  FROM s;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_customers_page(
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 20,
  p_q text DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_tier text DEFAULT 'all',
  p_segment text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  page_num int := GREATEST(COALESCE(p_page, 1), 1);
  page_size int := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  off int := (GREATEST(COALESCE(p_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  qpat text := NULL;
  status_filter text := lower(trim(coalesce(nullif(p_status, ''), 'all')));
  tier_filter text := lower(trim(coalesce(nullif(p_tier, ''), 'all')));
  segment_filter text := lower(trim(coalesce(nullif(p_segment, ''), 'all')));
  result jsonb;
BEGIN
  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;

  WITH enriched AS (
    SELECT
      c.*,
      public.app_customer_segment(c.raw) AS segment,
      coalesce(c.total_spent, 0) AS spent,
      coalesce(c.order_count, 0) AS orders_count,
      coalesce(c.source_created_at, c.source_updated_at, c.synced_at) AS joined_at
    FROM public.app_customers c
  ),
  filtered AS (
    SELECT *
    FROM enriched
    WHERE (status_filter = 'all' OR lower(coalesce(status, '')) = status_filter)
      AND (tier_filter = 'all' OR lower(coalesce(tier, '')) = tier_filter)
      AND (segment_filter = 'all' OR segment = segment_filter)
      AND (
        qpat IS NULL
        OR lower(coalesce(name, '')) LIKE qpat
        OR lower(coalesce(email, '')) LIKE qpat
        OR lower(coalesce(phone, '')) LIKE qpat
      )
  ),
  stats AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE lower(coalesce(status, '')) = 'active')::bigint AS active,
      count(*) FILTER (WHERE lower(coalesce(tier, '')) = 'vip')::bigint AS vip,
      count(*) FILTER (
        WHERE joined_at >= date_trunc('month', now())
          AND joined_at < date_trunc('month', now()) + interval '1 month'
      )::bigint AS new_this_month,
      coalesce(sum(spent), 0) AS total_revenue,
      count(*) FILTER (WHERE segment = 'champions')::bigint AS champions,
      count(*) FILTER (WHERE segment IN ('at-risk', 'cant-lose'))::bigint AS at_risk,
      count(*) FILTER (WHERE segment = 'loyal')::bigint AS loyal,
      count(*) FILTER (WHERE segment = 'potential-loyalist')::bigint AS potential_loyalist,
      count(*) FILTER (WHERE segment = 'cant-lose')::bigint AS cant_lose,
      count(*) FILTER (WHERE segment = 'hibernating')::bigint AS hibernating,
      count(*) FILTER (WHERE segment = 'need-attention')::bigint AS need_attention,
      count(*) FILTER (WHERE segment = 'unknown')::bigint AS unknown
    FROM filtered
  ),
  sorted AS (
    SELECT *
    FROM filtered
    ORDER BY coalesce(name, email, phone, id) ASC
    LIMIT page_size OFFSET off
  ),
  page_rows AS (
    SELECT coalesce(jsonb_agg(
      raw ||
      jsonb_strip_nulls(jsonb_build_object(
        'id', id,
        'userId', user_id,
        'name', name,
        'email', email,
        'phone', phone,
        'status', status,
        'tier', tier,
        'totalSpent', spent,
        'lifetimeValue', spent,
        'totalOrders', orders_count,
        'orderCount', orders_count,
        'avgOrderValue', CASE WHEN orders_count > 0 THEN spent / orders_count ELSE 0 END,
        'joinDate', coalesce(raw->>'joinDate', joined_at::text),
        'createdAt', coalesce(raw->>'createdAt', joined_at::text)
      ))
      ORDER BY coalesce(name, email, phone, id)
    ), '[]'::jsonb) AS customers
    FROM sorted
  ),
  read_model_total AS (
    SELECT count(*)::bigint AS c FROM public.app_customers
  )
  SELECT jsonb_build_object(
    'success', true,
    'customers', (SELECT customers FROM page_rows),
    'total', (SELECT total FROM stats),
    'readModelRows', (SELECT c FROM read_model_total),
    'page', page_num,
    'pageSize', page_size,
    'hasMore', ((SELECT total FROM stats) > (off + page_size)),
    'stats', jsonb_build_object(
      'total', (SELECT total FROM stats),
      'active', (SELECT active FROM stats),
      'vip', (SELECT vip FROM stats),
      'newThisMonth', (SELECT new_this_month FROM stats),
      'totalRevenue', (SELECT total_revenue FROM stats),
      'avgLTV', CASE WHEN (SELECT total FROM stats) > 0 THEN (SELECT total_revenue FROM stats) / (SELECT total FROM stats) ELSE 0 END,
      'champions', (SELECT champions FROM stats),
      'atRisk', (SELECT at_risk FROM stats),
      'segments', jsonb_build_object(
        'champions', (SELECT champions FROM stats),
        'loyal', (SELECT loyal FROM stats),
        'potentialLoyalist', (SELECT potential_loyalist FROM stats),
        'atRisk', (SELECT at_risk FROM stats),
        'cantLose', (SELECT cant_lose FROM stats),
        'hibernating', (SELECT hibernating FROM stats),
        'needAttention', (SELECT need_attention FROM stats),
        'unknown', (SELECT unknown FROM stats)
      )
    )
  )
  INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finances_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH orders_base AS (
    SELECT
      o.*,
      coalesce(o.total, 0) AS order_total,
      coalesce(o.source_created_at, o.source_updated_at, o.synced_at) AS order_ts,
      coalesce(o.payment_method, 'Cash') AS method,
      coalesce(o.vendor_id, o.vendor_name, 'Unknown') AS fallback_vendor_key
    FROM public.app_orders o
    WHERE lower(coalesce(o.status, '')) <> 'cancelled'
  ),
  line_parts AS (
    SELECT
      o.id AS order_id,
      coalesce(i.vendor_id, i.vendor_name, o.fallback_vendor_key, 'Unknown') AS vendor_key,
      coalesce(i.vendor_name, v.display_name, v.business_name, o.vendor_name, 'Unknown Vendor') AS vendor_name,
      coalesce(v.email, '') AS vendor_email,
      coalesce(i.line_total, coalesce(i.unit_price, 0) * coalesce(i.quantity, 1), 0) AS line_subtotal,
      coalesce(
        public.app_read_model_num(i.raw->>'commissionRate'),
        public.app_read_model_num(i.raw->>'commission'),
        public.app_read_model_num(p.raw->>'commissionRate'),
        0
      ) AS commission_rate
    FROM orders_base o
    LEFT JOIN public.app_order_items i ON i.order_id = o.id
    LEFT JOIN LATERAL (
      SELECT p.*
      FROM public.app_products p
      WHERE p.id = i.product_id OR lower(p.sku) = lower(coalesce(i.sku, ''))
      ORDER BY CASE WHEN p.id = i.product_id THEN 0 ELSE 1 END
      LIMIT 1
    ) p ON true
    LEFT JOIN public.app_vendors v ON v.id = coalesce(i.vendor_id, o.vendor_id)
  ),
  order_commission AS (
    SELECT
      order_id,
      coalesce(sum(line_subtotal * (commission_rate / 100)), 0) AS commission
    FROM line_parts
    GROUP BY order_id
  ),
  order_vendor_net AS (
    SELECT
      lp.order_id,
      lp.vendor_key,
      max(lp.vendor_name) AS vendor_name,
      max(lp.vendor_email) AS vendor_email,
      greatest(0, sum(lp.line_subtotal - (lp.line_subtotal * (lp.commission_rate / 100)))) AS net
    FROM line_parts lp
    GROUP BY lp.order_id, lp.vendor_key
  ),
  summary AS (
    SELECT
      coalesce(sum(o.order_total), 0) AS total_revenue,
      coalesce(sum(coalesce(oc.commission, 0)), 0) AS total_commission,
      coalesce(sum(greatest(0, o.order_total - coalesce(oc.commission, 0))), 0) AS total_vendor_payout,
      coalesce(sum(greatest(0, o.order_total - coalesce(oc.commission, 0))) FILTER (
        WHERE lower(coalesce(o.status, '')) IN ('completed', 'delivered')
      ), 0) AS pending_payouts
    FROM orders_base o
    LEFT JOIN order_commission oc ON oc.order_id = o.id
  ),
  payment_methods AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'method', method,
      'transactions', transactions,
      'amount', amount,
      'percentage', CASE WHEN (SELECT total_revenue FROM summary) > 0 THEN (amount / (SELECT total_revenue FROM summary)) * 100 ELSE 0 END
    ) ORDER BY amount DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT method, count(*)::bigint AS transactions, coalesce(sum(order_total), 0) AS amount
      FROM orders_base
      GROUP BY method
    ) s
  ),
  revenue_chart AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'date', to_char(day, 'Mon DD'),
      'revenue', revenue,
      'commission', commission
    ) ORDER BY day), '[]'::jsonb) AS rows
    FROM (
      SELECT
        date_trunc('day', o.order_ts)::date AS day,
        coalesce(sum(o.order_total), 0) AS revenue,
        coalesce(sum(coalesce(oc.commission, 0)), 0) AS commission
      FROM orders_base o
      LEFT JOIN order_commission oc ON oc.order_id = o.id
      GROUP BY date_trunc('day', o.order_ts)::date
      ORDER BY day DESC
      LIMIT 30
    ) s
  ),
  vendor_payouts AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', vendor_key,
      'vendor', vendor_name,
      'email', vendor_email,
      'payout', payout,
      'orders', orders,
      'status', 'pending'
    ) ORDER BY payout DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT
        vendor_key,
        max(vendor_name) AS vendor_name,
        max(vendor_email) AS vendor_email,
        coalesce(sum(net), 0) AS payout,
        count(DISTINCT order_id)::bigint AS orders
      FROM order_vendor_net
      GROUP BY vendor_key
    ) s
  ),
  transactions AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', coalesce(o.order_number, o.id),
      'date', coalesce(o.raw->>'date', o.raw->>'createdAt', o.order_ts::text),
      'customer', coalesce(o.customer_name, 'Guest'),
      'customerEmail', coalesce(o.email, ''),
      'vendor', coalesce(o.vendor_name, 'Unknown Vendor'),
      'vendorId', coalesce(o.vendor_id, o.vendor_name, 'Unknown'),
      'amount', o.order_total,
      'method', o.method,
      'status', CASE WHEN lower(coalesce(o.status, '')) IN ('delivered', 'completed') THEN 'completed' ELSE o.status END,
      'commission', coalesce(oc.commission, 0),
      'vendorPayout', greatest(0, o.order_total - coalesce(oc.commission, 0)),
      'products', coalesce(o.raw->'items', '[]'::jsonb),
      'gatewayFee', CASE WHEN o.method NOT IN ('Cash', 'COD') THEN o.order_total * 0.01 ELSE 0 END,
      'shippingAddress', coalesce(o.raw->>'shippingAddress', ''),
      'trackingNumber', coalesce(o.raw->>'trackingNumber', '')
    ) ORDER BY o.order_ts DESC), '[]'::jsonb) AS rows
    FROM orders_base o
    LEFT JOIN order_commission oc ON oc.order_id = o.id
  ),
  read_model_total AS (
    SELECT count(*)::bigint AS c FROM public.app_orders
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'totalRevenue', (SELECT total_revenue FROM summary),
      'totalCommission', (SELECT total_commission FROM summary),
      'totalVendorPayout', (SELECT total_vendor_payout FROM summary),
      'pendingPayouts', (SELECT pending_payouts FROM summary)
    ),
    'transactions', (SELECT rows FROM transactions),
    'paymentMethods', (SELECT rows FROM payment_methods),
    'revenueChartData', (SELECT rows FROM revenue_chart),
    'vendorPayouts', (SELECT rows FROM vendor_payouts),
    'readModelRows', (SELECT c FROM read_model_total),
    'timestamp', now()
  )
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_customers_page IS 'Paged admin customers backed by app_customers read model; preserves Edge API response shape.';
COMMENT ON FUNCTION public.rpc_finances_analytics IS 'Finance analytics backed by app_orders/app_order_items/app_products/app_vendors read models.';

-- ========================================
-- 20260616090000_kv_domain_realtime_pulse.sql
-- ========================================
-- Public-safe realtime heartbeat rows for broad KV domains.
--
-- This replaces the frontend's unfiltered kv_store_16010b6f subscription with
-- a tiny pulse table. Browsers receive only domain names + non-PII detail, not
-- every KV row payload.

CREATE TABLE IF NOT EXISTS public.app_kv_domain_pulse (
  domain text PRIMARY KEY CHECK (
    domain IN ('products', 'categories', 'customers', 'vendors', 'marketing')
  ),
  bump bigint NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_kv_domain_pulse (domain, bump, detail, updated_at)
VALUES
  ('products', 0, '{}'::jsonb, now()),
  ('categories', 0, '{}'::jsonb, now()),
  ('customers', 0, '{}'::jsonb, now()),
  ('vendors', 0, '{}'::jsonb, now()),
  ('marketing', 0, '{}'::jsonb, now())
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
  ELSIF kv_key LIKE 'vendor:audience:%' THEN
    kv_domain := 'customers';
    audience_vendor_id := btrim(substr(kv_key, length('vendor:audience:') + 1));
    IF audience_vendor_id <> '' THEN
      kv_detail := jsonb_build_object('event', 'audience', 'vendorIds', jsonb_build_array(audience_vendor_id));
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
    -- app_vendor_application_pulse handles this domain with faster debounce.
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

DROP TRIGGER IF EXISTS trg_kv_store_domain_pulse_iu ON public.kv_store_16010b6f;
CREATE TRIGGER trg_kv_store_domain_pulse_iu
  AFTER INSERT OR UPDATE ON public.kv_store_16010b6f
  FOR EACH ROW
  EXECUTE PROCEDURE public.bump_app_kv_domain_pulse();

DROP TRIGGER IF EXISTS trg_kv_store_domain_pulse_del ON public.kv_store_16010b6f;
CREATE TRIGGER trg_kv_store_domain_pulse_del
  AFTER DELETE ON public.kv_store_16010b6f
  FOR EACH ROW
  EXECUTE PROCEDURE public.bump_app_kv_domain_pulse();

ALTER TABLE public.app_kv_domain_pulse REPLICA IDENTITY FULL;

-- skipped Supabase Realtime publication block

-- skipped Supabase RLS enable
-- skipped Supabase RLS policy drop
-- skipped Supabase RLS policy

-- skipped Supabase role grant
COMMENT ON TABLE public.app_kv_domain_pulse IS 'Small non-PII heartbeat table for broad KV realtime invalidation domains.';

-- ========================================
-- 20260616100000_dashboard_stats_read_model_rpc.sql
-- ========================================
-- SQL-backed admin dashboard stats from app_* read models.
-- Edge falls back to the legacy KV implementation when this is unavailable or not backfilled.

CREATE OR REPLACE FUNCTION public.app_dashboard_date_range(
  p_filter text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  start_at timestamptz,
  end_at timestamptz,
  compare_start_at timestamptz,
  compare_end_at timestamptz
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  filter_text text := coalesce(nullif(btrim(p_filter), ''), 'Last 30 days');
  custom text[];
  period interval;
BEGIN
  custom := regexp_match(filter_text, '^DashboardRange:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$');
  IF custom IS NOT NULL THEN
    start_at := custom[1]::date::timestamptz;
    end_at := (custom[2]::date + 1)::timestamptz - interval '1 millisecond';
    period := greatest(end_at - start_at + interval '1 millisecond', interval '1 day');
    compare_end_at := start_at;
    compare_start_at := compare_end_at - period;
    RETURN NEXT;
    RETURN;
  END IF;

  end_at := p_now;

  CASE filter_text
    WHEN 'Last 7 days' THEN
      start_at := p_now - interval '7 days';
      compare_start_at := p_now - interval '14 days';
      compare_end_at := p_now - interval '7 days';
    WHEN 'Last 30 days' THEN
      start_at := p_now - interval '30 days';
      compare_start_at := p_now - interval '60 days';
      compare_end_at := p_now - interval '30 days';
    WHEN 'Last 3 months' THEN
      start_at := date_trunc('day', p_now) - interval '3 months';
      compare_start_at := date_trunc('day', p_now) - interval '6 months';
      compare_end_at := date_trunc('day', p_now) - interval '3 months';
    WHEN 'Last 6 months' THEN
      start_at := date_trunc('day', p_now) - interval '6 months';
      compare_start_at := date_trunc('day', p_now) - interval '12 months';
      compare_end_at := date_trunc('day', p_now) - interval '6 months';
    WHEN 'Last year' THEN
      start_at := date_trunc('day', p_now) - interval '1 year';
      compare_start_at := date_trunc('day', p_now) - interval '2 years';
      compare_end_at := date_trunc('day', p_now) - interval '1 year';
    WHEN 'All time' THEN
      start_at := '1970-01-01 00:00:00+00'::timestamptz;
      compare_start_at := '1970-01-01 00:00:00+00'::timestamptz;
      compare_end_at := '1970-01-01 00:00:00+00'::timestamptz;
    ELSE
      start_at := p_now - interval '30 days';
      compare_start_at := p_now - interval '60 days';
      compare_end_at := p_now - interval '30 days';
  END CASE;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_dashboard_stats(
  p_revenue_filter text DEFAULT 'Last 30 days',
  p_orders_filter text DEFAULT 'Last 30 days',
  p_customers_filter text DEFAULT 'Last 30 days',
  p_products_filter text DEFAULT 'Last 30 days',
  p_global_filter text DEFAULT 'All time'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_now timestamptz := now();
  revenue_start timestamptz;
  revenue_end timestamptz;
  revenue_compare_start timestamptz;
  revenue_compare_end timestamptz;
  orders_start timestamptz;
  orders_end timestamptz;
  orders_compare_start timestamptz;
  orders_compare_end timestamptz;
  customers_start timestamptz;
  customers_end timestamptz;
  customers_compare_start timestamptz;
  customers_compare_end timestamptz;
  products_start timestamptz;
  products_end timestamptz;
  products_compare_start timestamptz;
  products_compare_end timestamptz;
  global_start timestamptz;
  global_end timestamptz;
  global_compare_start timestamptz;
  global_compare_end timestamptz;
  result jsonb;
BEGIN
  SELECT start_at, end_at, compare_start_at, compare_end_at
  INTO revenue_start, revenue_end, revenue_compare_start, revenue_compare_end
  FROM public.app_dashboard_date_range(p_revenue_filter, v_now);

  SELECT start_at, end_at, compare_start_at, compare_end_at
  INTO orders_start, orders_end, orders_compare_start, orders_compare_end
  FROM public.app_dashboard_date_range(p_orders_filter, v_now);

  SELECT start_at, end_at, compare_start_at, compare_end_at
  INTO customers_start, customers_end, customers_compare_start, customers_compare_end
  FROM public.app_dashboard_date_range(p_customers_filter, v_now);

  SELECT start_at, end_at, compare_start_at, compare_end_at
  INTO products_start, products_end, products_compare_start, products_compare_end
  FROM public.app_dashboard_date_range(p_products_filter, v_now);

  SELECT start_at, end_at, compare_start_at, compare_end_at
  INTO global_start, global_end, global_compare_start, global_compare_end
  FROM public.app_dashboard_date_range(p_global_filter, v_now);

  WITH orders_base AS (
    SELECT
      o.id,
      o.order_number,
      coalesce(o.customer_name, o.raw->>'customer', 'Unknown Customer') AS customer_name,
      coalesce(o.status, 'pending') AS status,
      coalesce(o.total, public.app_read_model_num(o.raw->>'amount'), 0) AS total,
      coalesce(o.source_created_at, o.source_updated_at, o.synced_at) AS order_ts,
      o.raw
    FROM public.app_orders o
  ),
  products_base AS (
    SELECT
      p.id,
      p.name,
      coalesce(p.price, public.app_read_model_num(p.raw->>'salePrice'), public.app_read_model_num(p.raw->>'originalPrice'), 0) AS price,
      coalesce(p.source_created_at, p.source_updated_at, p.synced_at) AS product_ts
    FROM public.app_products p
  ),
  customers_base AS (
    SELECT
      c.id,
      coalesce(c.source_created_at, c.source_updated_at, c.synced_at) AS customer_ts
    FROM public.app_customers c
  ),
  revenue_stats AS (
    SELECT
      coalesce(sum(total) FILTER (WHERE order_ts >= revenue_start AND order_ts <= revenue_end), 0) AS current_revenue,
      coalesce(sum(total) FILTER (
        WHERE coalesce(p_revenue_filter, '') <> 'All time'
          AND order_ts >= revenue_compare_start
          AND order_ts < revenue_compare_end
      ), 0) AS compare_revenue
    FROM orders_base
  ),
  order_stats AS (
    SELECT
      count(*) FILTER (WHERE order_ts >= orders_start AND order_ts <= orders_end)::bigint AS current_orders,
      count(*) FILTER (
        WHERE coalesce(p_orders_filter, '') <> 'All time'
          AND order_ts >= orders_compare_start
          AND order_ts < orders_compare_end
      )::bigint AS compare_orders
    FROM orders_base
  ),
  customer_stats AS (
    SELECT
      count(*)::bigint AS all_customers,
      count(*) FILTER (WHERE customer_ts >= customers_start AND customer_ts <= customers_end)::bigint AS current_customers,
      count(*) FILTER (
        WHERE coalesce(p_customers_filter, '') <> 'All time'
          AND customer_ts >= customers_compare_start
          AND customer_ts < customers_compare_end
      )::bigint AS compare_customers
    FROM customers_base
  ),
  product_stats AS (
    SELECT
      count(*)::bigint AS all_products,
      count(*) FILTER (WHERE product_ts >= products_start AND product_ts <= products_end)::bigint AS current_products,
      count(*) FILTER (
        WHERE coalesce(p_products_filter, '') <> 'All time'
          AND product_ts >= products_compare_start
          AND product_ts < products_compare_end
      )::bigint AS compare_products
    FROM products_base
  ),
  section_orders AS (
    SELECT *
    FROM orders_base
    WHERE order_ts >= global_start AND order_ts <= global_end
  ),
  trend_months AS (
    SELECT m.month_start, m.ordinal
    FROM (
      SELECT
        gs AS month_start,
        row_number() OVER (ORDER BY gs) AS ordinal
      FROM generate_series(
        CASE
          WHEN coalesce(p_global_filter, '') = 'All time'
            THEN date_trunc('month', v_now) - interval '6 months'
          ELSE date_trunc('month', global_start)
        END,
        CASE
          WHEN coalesce(p_global_filter, '') = 'All time'
            THEN date_trunc('month', v_now)
          ELSE date_trunc('month', global_end)
        END,
        interval '1 month'
      ) AS gs
    ) m
    WHERE m.ordinal <= 36
  ),
  sales_trend AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', CASE
        WHEN coalesce(p_global_filter, '') = 'All time' THEN to_char(month_start, 'Mon')
        ELSE to_char(month_start, 'Mon YYYY')
      END,
      'sales', round(coalesce(month_revenue, 0)),
      'orders', coalesce(month_orders, 0)
    ) ORDER BY month_start), '[]'::jsonb) AS rows
    FROM (
      SELECT
        tm.month_start,
        coalesce(sum(so.total), 0) AS month_revenue,
        count(so.id)::bigint AS month_orders
      FROM trend_months tm
      LEFT JOIN section_orders so
        ON so.order_ts >= greatest(tm.month_start, global_start)
       AND so.order_ts <= least(tm.month_start + interval '1 month' - interval '1 millisecond', global_end)
      GROUP BY tm.month_start
    ) s
  ),
  top_products AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', name,
      'sales', sales,
      'revenue', round(revenue)
    ) ORDER BY sales DESC, revenue DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT
        coalesce(max(i.name), max(p.name), 'Unknown Product') AS name,
        coalesce(sum(coalesce(i.quantity, 1)), 0)::bigint AS sales,
        coalesce(sum(coalesce(i.line_total, coalesce(i.unit_price, p.price, 0) * coalesce(i.quantity, 1))), 0) AS revenue
      FROM section_orders so
      JOIN public.app_order_items i ON i.order_id = so.id
      LEFT JOIN products_base p ON p.id = i.product_id
      WHERE coalesce(i.product_id, '') <> ''
      GROUP BY i.product_id
      ORDER BY sales DESC, revenue DESC
      LIMIT 4
    ) s
  ),
  recent_orders AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', coalesce(order_number, id),
      'customer', coalesce(customer_name, 'Unknown Customer'),
      'product', coalesce(first_product, 'Multiple Items'),
      'amount', total,
      'status', coalesce(status, 'pending')
    ) ORDER BY order_ts DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT
        so.id,
        so.order_number,
        so.customer_name,
        so.total,
        so.status,
        so.order_ts,
        fi.name AS first_product
      FROM section_orders so
      LEFT JOIN LATERAL (
        SELECT coalesce(i.name, 'Multiple Items') AS name
        FROM public.app_order_items i
        WHERE i.order_id = so.id
        ORDER BY i.line_index ASC
        LIMIT 1
      ) fi ON true
      ORDER BY so.order_ts DESC
      LIMIT 5
    ) s
  ),
  read_model_counts AS (
    SELECT
      (SELECT count(*)::bigint FROM public.app_orders) AS orders,
      (SELECT count(*)::bigint FROM public.app_products) AS products,
      (SELECT count(*)::bigint FROM public.app_customers) AS customers
  )
  SELECT jsonb_build_object(
    'totalRevenue', (SELECT current_revenue FROM revenue_stats),
    'totalOrders', (SELECT current_orders FROM order_stats),
    'totalCustomers', CASE
      WHEN coalesce(p_customers_filter, '') = 'All time' THEN (SELECT all_customers FROM customer_stats)
      ELSE (SELECT current_customers FROM customer_stats)
    END,
    'totalProducts', CASE
      WHEN coalesce(p_products_filter, '') = 'All time' THEN (SELECT all_products FROM product_stats)
      ELSE (SELECT current_products FROM product_stats)
    END,
    'revenueChange', CASE
      WHEN (SELECT compare_revenue FROM revenue_stats) > 0
        THEN round((((SELECT current_revenue FROM revenue_stats) - (SELECT compare_revenue FROM revenue_stats)) / (SELECT compare_revenue FROM revenue_stats)) * 100, 1)
      ELSE 0
    END,
    'ordersChange', CASE
      WHEN (SELECT compare_orders FROM order_stats) > 0
        THEN round((((SELECT current_orders FROM order_stats) - (SELECT compare_orders FROM order_stats))::numeric / (SELECT compare_orders FROM order_stats)) * 100, 1)
      ELSE 0
    END,
    'customersChange', CASE
      WHEN (SELECT compare_customers FROM customer_stats) > 0
        THEN round((((SELECT current_customers FROM customer_stats) - (SELECT compare_customers FROM customer_stats))::numeric / (SELECT compare_customers FROM customer_stats)) * 100, 1)
      ELSE 0
    END,
    'productsChange', CASE
      WHEN (SELECT compare_products FROM product_stats) > 0
        THEN round((((SELECT current_products FROM product_stats) - (SELECT compare_products FROM product_stats))::numeric / (SELECT compare_products FROM product_stats)) * 100, 1)
      ELSE 0
    END,
    'salesTrend', (SELECT rows FROM sales_trend),
    'topProducts', (SELECT rows FROM top_products),
    'recentOrders', (SELECT rows FROM recent_orders),
    'lastUpdated', v_now,
    'readModelRows', (SELECT orders + products + customers FROM read_model_counts),
    'readModelCounts', jsonb_build_object(
      'orders', (SELECT orders FROM read_model_counts),
      'products', (SELECT products FROM read_model_counts),
      'customers', (SELECT customers FROM read_model_counts)
    )
  )
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_dashboard_stats IS 'Admin dashboard stats backed by app_orders/app_order_items/app_products/app_customers read models.';

CREATE OR REPLACE FUNCTION public.rpc_basic_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH orders_base AS (
    SELECT
      coalesce(status, 'pending') AS status,
      coalesce(total, public.app_read_model_num(raw->>'amount'), 0) AS total
    FROM public.app_orders
  ),
  counts AS (
    SELECT
      (SELECT count(*)::bigint FROM public.app_products) AS products,
      (SELECT count(*)::bigint FROM public.app_orders) AS orders,
      (SELECT count(*)::bigint FROM public.app_customers) AS customers,
      coalesce(sum(total) FILTER (WHERE lower(coalesce(status, '')) <> 'cancelled'), 0) AS revenue,
      count(*) FILTER (WHERE lower(coalesce(status, '')) = 'pending')::bigint AS pending_orders,
      count(*) FILTER (WHERE lower(coalesce(status, '')) IN ('delivered', 'completed'))::bigint AS completed_orders
    FROM orders_base
  )
  SELECT jsonb_build_object(
    'totalProducts', products,
    'totalOrders', orders,
    'totalCustomers', customers,
    'totalRevenueNumber', revenue,
    'pendingOrders', pending_orders,
    'completedOrders', completed_orders,
    'readModelRows', products + orders + customers,
    'timestamp', now()
  )
  INTO result
  FROM counts;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_landing_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH counts AS (
    SELECT
      (SELECT count(*)::bigint FROM public.app_vendors WHERE lower(coalesce(status, '')) = 'active') AS active_vendors,
      (SELECT count(*)::bigint FROM public.app_products) AS products,
      (SELECT count(*)::bigint FROM public.app_customers) AS customers,
      (SELECT count(*)::bigint FROM public.app_vendors) AS vendors
  )
  SELECT jsonb_build_object(
    'activeVendors', active_vendors,
    'totalProducts', products,
    'totalCustomers', customers,
    'readModelRows', vendors + products + customers,
    'timestamp', now()
  )
  INTO result
  FROM counts;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_basic_stats IS 'Simple platform stats backed by app_orders/app_products/app_customers read models.';
COMMENT ON FUNCTION public.rpc_landing_stats IS 'Public landing stats backed by app_vendors/app_products/app_customers read models.';
