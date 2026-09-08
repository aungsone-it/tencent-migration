-- Sort admin/vendor order lists by NOS serial (not createdAt).
-- CREATE OR REPLACE so already-deployed databases pick this up.

CREATE OR REPLACE FUNCTION public.app_order_serial(p_order_number text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN upper(btrim(coalesce(p_order_number, ''))) ~ '(NOS|MOS|ORD)-[0-9]+$'
    THEN substring(upper(btrim(p_order_number)) from '[0-9]+$')::bigint
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.app_order_serial(text) IS 'Numeric serial from NOS-/MOS-/ORD- order numbers for listing sort.';

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
        public.app_order_serial(coalesce(order_number, raw->>'orderNumber')) AS order_serial,
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
            'date', coalesce(raw->>'date', raw->>'createdAt', synced_at::text),
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
  USING status_filter, payment_filter, vendor_filter, from_ts, to_ts, qpat
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_orders_page IS 'Paged admin orders list backed by app_orders read model; preserves Edge API response shape.';

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
        public.app_order_serial(coalesce(o.order_number, o.raw->>'orderNumber')) AS order_serial,
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
      ORDER BY order_serial %s NULLS LAST, order_ts %s NULLS LAST, id %s
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
      'summary', jsonb_build_object(
        'totalRevenue', (SELECT total_revenue FROM counts),
        'pending', (SELECT pending_count FROM counts),
        'processing', (SELECT processing_count FROM counts),
        'fulfilled', (SELECT fulfilled_count FROM counts),
        'cancelled', (SELECT cancelled_count FROM counts)
      )
    )
  $sql$, sort_dir, sort_dir, sort_dir, page_size, off, sort_dir, sort_dir, sort_dir, page_num, page_size, off, page_size)
  USING vendor_ids, status_filter, payment_filter, from_ts, to_ts, qpat
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_vendor_orders_page IS 'Paged vendor-admin orders list backed by app_orders/app_order_items; preserves Edge API response shape.';
