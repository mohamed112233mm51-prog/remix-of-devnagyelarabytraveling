
CREATE OR REPLACE FUNCTION public.reset_production_business_data(p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_summary jsonb := '{}'::jsonb;
  v_count bigint;
  t text;
  wipe_tables text[] := ARRAY[
    'payment_splits',
    'financial_audit_log',
    'expense_deductions',
    'expenses',
    'investor_transactions',
    'merchant_cash_collections',
    'currency_supplier_transactions',
    'usd_treasury_transactions',
    'company_transactions',
    'transactions',
    'submissions',
    'executions',
    'company_pricing_rules',
    'activity_logs',
    'import_batches',
    'investors',
    'merchants',
    'currency_suppliers',
    'issuing_companies',
    'agents'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: يجب تسجيل الدخول';
  END IF;
  SELECT public.has_role(v_uid, 'admin'::public.app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: صلاحيات المسؤول مطلوبة';
  END IF;
  IF p_confirm IS DISTINCT FROM 'تهيئة الإنتاج نهائياً' THEN
    RAISE EXCEPTION 'CONFIRM_MISMATCH: عبارة التأكيد غير مطابقة';
  END IF;

  -- Disable user triggers on cash-flow tables so cascading balance updates
  -- and non-negative-balance guards don't block the wipe. The full body runs
  -- in a single implicit transaction; a failure rolls everything back.
  EXECUTE 'ALTER TABLE public.payment_splits DISABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.cash_boxes    DISABLE TRIGGER USER';

  -- Delete children → parents. EXECUTE preserves order and captures row counts.
  FOREACH t IN ARRAY wipe_tables LOOP
    EXECUTE format('DELETE FROM public.%I', t);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object(t, v_count);
  END LOOP;

  -- Reset cash box balances + opening balances (entities preserved).
  UPDATE public.cash_boxes
     SET balance         = 0,
         opening_balance = 0,
         opening_date    = NULL,
         opening_note    = NULL,
         updated_at      = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('cash_boxes_reset', v_count);

  -- Re-enable triggers before returning.
  EXECUTE 'ALTER TABLE public.payment_splits ENABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.cash_boxes    ENABLE TRIGGER USER';

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort re-enable on error so the DB doesn't stay with triggers off.
  BEGIN EXECUTE 'ALTER TABLE public.payment_splits ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.cash_boxes    ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_production_business_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_production_business_data(text) TO authenticated;
