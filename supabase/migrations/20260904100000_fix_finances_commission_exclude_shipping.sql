-- Fix finances commission: vendor payout is product line net minus commission (shipping excluded).
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
      CASE
        WHEN coalesce(o.subtotal, 0) > 0 AND coalesce(o.discount, 0) > 0 THEN greatest(
          0,
          round(
            (
              coalesce(i.line_total, coalesce(i.unit_price, 0) * coalesce(i.quantity, 1), 0)
              - (
                coalesce(o.discount, 0)
                * coalesce(i.line_total, coalesce(i.unit_price, 0) * coalesce(i.quantity, 1), 0)
                / o.subtotal
              )
            )::numeric,
            2
          )
        )
        ELSE coalesce(i.line_total, coalesce(i.unit_price, 0) * coalesce(i.quantity, 1), 0)
      END AS line_subtotal,
      coalesce(
        public.app_read_model_num(i.raw->>'commissionRate'),
        public.app_read_model_num(i.raw->>'commission'),
        CASE
          WHEN p.raw ? 'commissionRate'
            THEN public.app_read_model_num(p.raw->>'commissionRate')
        END,
        v.commission_percent,
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
    WHERE i.order_id IS NOT NULL
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
  order_tx_vendor_payout AS (
    SELECT
      order_id,
      coalesce(sum(net), 0) AS vendor_payout
    FROM order_vendor_net
    GROUP BY order_id
  ),
  summary AS (
    SELECT
      (SELECT coalesce(sum(order_total), 0) FROM orders_base) AS total_revenue,
      (SELECT coalesce(sum(commission), 0) FROM order_commission) AS total_commission,
      (SELECT coalesce(sum(net), 0) FROM order_vendor_net) AS total_vendor_payout,
      (
        SELECT coalesce(sum(ovn.net), 0)
        FROM order_vendor_net ovn
        JOIN orders_base o ON o.id = ovn.order_id
        WHERE lower(coalesce(o.status, '')) IN ('completed', 'delivered')
      ) AS pending_payouts
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
      'vendorPayout', coalesce(otp.vendor_payout, 0),
      'products', coalesce(o.raw->'items', '[]'::jsonb),
      'gatewayFee', CASE WHEN o.method NOT IN ('Cash', 'COD') THEN o.order_total * 0.01 ELSE 0 END,
      'shippingAddress', coalesce(o.raw->>'shippingAddress', ''),
      'trackingNumber', coalesce(o.raw->>'trackingNumber', '')
    ) ORDER BY o.order_ts DESC), '[]'::jsonb) AS rows
    FROM orders_base o
    LEFT JOIN order_commission oc ON oc.order_id = o.id
    LEFT JOIN order_tx_vendor_payout otp ON otp.order_id = o.id
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

COMMENT ON FUNCTION public.rpc_finances_analytics IS 'Finance analytics: commission on product lines only; vendor payout excludes shipping.';
