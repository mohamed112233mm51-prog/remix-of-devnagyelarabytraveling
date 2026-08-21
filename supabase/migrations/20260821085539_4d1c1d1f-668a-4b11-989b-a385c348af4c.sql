CREATE OR REPLACE FUNCTION public.merchant_available_balance(p_merchant_id uuid, p_currency text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH cur AS (SELECT public.app_normalize_currency(p_currency) AS code),
  tx AS (
    SELECT COALESCE(SUM(
      CASE
        WHEN t.source_service_type = 'merchant_cash_out' THEN abs(COALESCE(t.paid,0))
        WHEN t.source_service_type IN ('merchant_cash_out_to_company','merchant_cash_out_to_agent') THEN -abs(COALESCE(t.paid,0))
        ELSE (
          CASE WHEN COALESCE(t.merchant_cash_net_amount,0) > 0
               THEN round(COALESCE(t.merchant_cash_net_amount,0))
               ELSE round(COALESCE(t.merchant_cash_amount,0) - COALESCE(t.merchant_cash_amount,0) * 0.01)
          END
        ) + COALESCE(t.merchant_cash_physical_amount,0)
      END
    ), 0) AS total
    FROM public.transactions t, cur
    WHERE t.merchant_id = p_merchant_id
      AND t.cancelled_at IS NULL
      AND public.app_normalize_currency(t.currency) = cur.code
  ),
  ct AS (
    SELECT COALESCE(SUM(
      -round(
        abs(COALESCE(NULLIF(c.merchant_cash_net_amount,0), c.merchant_cash_amount, 0))
        + abs(COALESCE(c.merchant_cash_physical_amount,0))
      )
    ), 0) AS total
    FROM public.company_transactions c, cur
    WHERE c.merchant_id = p_merchant_id
      AND c.cancelled_at IS NULL
      AND public.app_normalize_currency(COALESCE(c.payment_currency, c.currency)) = cur.code
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions t2
        WHERE t2.merchant_id IS NOT NULL
          AND t2.source_service_type = 'merchant_cash_out_to_company'
          AND t2.source_service_id = c.id::text
      )
  ),
  col AS (
    SELECT COALESCE(SUM(-COALESCE(m.amount,0)), 0) AS total
    FROM public.merchant_cash_collections m, cur
    WHERE m.merchant_id = p_merchant_id
      AND m.cancelled_at IS NULL
      AND public.app_normalize_currency(m.opening_currency) = cur.code
  ),
  usd AS (
    SELECT COALESCE(SUM(-COALESCE(u.egp_amount,0)), 0) AS total
    FROM public.usd_treasury_transactions u, cur
    WHERE u.merchant_id = p_merchant_id
      AND u.cancelled_at IS NULL
      AND u.type = 'conversion'
      AND u.source_type IN ('merchant_wallet','merchant_physical')
      AND cur.code = 'EGP'
  )
  SELECT round((SELECT total FROM tx) + (SELECT total FROM ct) + (SELECT total FROM col) + (SELECT total FROM usd), 2);
$$;

CREATE OR REPLACE FUNCTION public.assert_merchant_balance(p_merchant_id uuid, p_currency text, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text := public.app_normalize_currency(p_currency);
  v_available numeric := public.merchant_available_balance(p_merchant_id, p_currency);
  v_name text;
BEGIN
  SELECT merchant_name INTO v_name FROM public.merchants WHERE id = p_merchant_id;
  IF COALESCE(p_amount,0) > v_available THEN
    RETURN jsonb_build_object(
      'ok', false,
      'merchant_id', p_merchant_id,
      'merchant_name', COALESCE(v_name,'تاجر'),
      'currency', v_code,
      'available', v_available,
      'requested', COALESCE(p_amount,0),
      'shortfall', COALESCE(p_amount,0) - v_available
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'merchant_id', p_merchant_id, 'currency', v_code, 'available', v_available, 'requested', COALESCE(p_amount,0));
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_available_balance(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.assert_merchant_balance(uuid, text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.merchant_available_balance(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_merchant_balance(uuid, text, numeric) TO authenticated, service_role;