-- Filter admin/vendor order lists by UTC calendar day (createdAt), matching the Orders UI Date column.

CREATE OR REPLACE FUNCTION public.app_order_list_calendar_day(
  raw jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(
    coalesce(
      public.app_read_model_timestamptz(nullif(btrim(coalesce(raw->>'createdAt', '')), '')),
      source_created_at,
      source_updated_at,
      synced_at
    ) AT TIME ZONE 'UTC',
    'YYYY-MM-DD'
  );
$$;

COMMENT ON FUNCTION public.app_order_list_calendar_day IS 'UTC yyyy-MM-dd for admin order list date filter/display.';

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
  from_day text := NULLIF(left(btrim(coalesce(p_date_from, '')), 10), '');
  to_day text := NULLIF(left(btrim(coalesce(p_date_to, '')), 10), '');
  result jsonb;
BEGIN
  IF p_q IS NOT NULL AND length(trim(p_q)) > 0 THEN
    qpat := '%' || lower(trim(p_q)) || '%';
  END IF;

  EXECUTE format($sql$
    WITH base AS (
      SELECT
        id,
        raw,
        coalesce(nullif(vendor_name, ''), 'SECURE Store') AS vendor_label,
        synced_at,
        coalesce(source_created_at, source_updated_at, synced_at) AS order_ts,
        public.app_order_serial(coalesce(order_number, raw->>'orderNumber')) AS order_serial,
        coalesce(total, 0) AS total_num,
        coalesce(status, 'pending') AS status_value,
        coalesce(payment_status, 'pending') AS payment_status_value,
        public.app_order_list_calendar_day(raw, source_created_at, source_updated_at, synced_at) AS order_day
      FROM public.app_orders
      WHERE ($1::text = 'all' OR lower(coalesce(status, '')) = $1::text)
        AND ($2::text = 'all' OR lower(coalesce(payment_status, '')) = $2::text)
        AND (
          $3::text = 'all'
          OR coalesce(nullif(vendor_name, ''), 'SECURE Store') = $3::text
        )
        AND (
          $6::text IS NULL
          OR lower(coalesce(order_number, '')) LIKE $6::text
          OR lower(coalesce(customer_name, '')) LIKE $6::text
          OR lower(coalesce(email, '')) LIKE $6::text
          OR lower(coalesce(phone, '')) LIKE $6::text
          OR lower(id) LIKE $6::text
        )
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE ($4::text IS NULL OR order_day >= $4::text)
        AND ($5::text IS NULL OR order_day <= $5::text)
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
      ORDER BY order_serial %s NULLS LAST, order_ts %s NULLS LAST, id %s
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
            'address', coalesce(raw->>'address', raw#>>'{shippingInfo,address}', ''),
            'city', coalesce(raw->>'city', raw#>>'{shippingInfo,city}', ''),
            'state', coalesce(raw->>'state', raw#>>'{shippingInfo,state}', raw->>'region', raw#>>'{shippingInfo,region}', ''),
            'zipCode', coalesce(raw->>'zipCode', raw#>>'{shippingInfo,zipCode}', ''),
            'sellerId', coalesce(
              nullif(raw->>'sellerId', ''),
              nullif(raw#>>'{shippingInfo,sellerId}', ''),
              nullif(raw->>'zipCode', ''),
              nullif(raw#>>'{shippingInfo,zipCode}', ''),
              ''
            ),
            'shippingInfo', coalesce(raw->'shippingInfo', '{}'::jsonb),
            'trackingNumber', raw->>'trackingNumber',
            'notes', raw->>'notes',
            'deliveryService', raw->>'deliveryService',
            'deliveryServiceLogo', raw->>'deliveryServiceLogo',
            'inventoryDeducted', coalesce(public.app_read_model_bool(raw->>'inventoryDeducted'), false),
            'refundStatus', lower(trim(coalesce(raw#>>'{kpay,refund,status}', ''))),
            'refundRequestNo', trim(coalesce(raw#>>'{kpay,refund,refundRequestNo}', '')),
            'refundAmount', coalesce(public.app_read_model_num(raw#>>'{kpay,refund,amount}'), 0),
            'refundedAt', trim(coalesce(raw#>>'{kpay,refund,refundedAt}', raw#>>'{kpay,refund,failedAt}', '')),
            'date', order_day,
            'createdAt', coalesce(raw->>'createdAt', synced_at::text),
            'updatedAt', coalesce(raw->>'updatedAt', synced_at::text)
          )
          ORDER BY order_serial %s NULLS LAST, order_ts %s NULLS LAST, id %s
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
  $sql$, sort_dir, sort_dir, sort_dir, page_size, off, sort_dir, sort_dir, sort_dir, page_num, page_size, off, page_size)
  USING status_filter, payment_filter, vendor_filter, from_day, to_day, qpat
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_orders_page IS 'Paged admin orders list backed by app_orders read model; preserves Edge API response shape.';
