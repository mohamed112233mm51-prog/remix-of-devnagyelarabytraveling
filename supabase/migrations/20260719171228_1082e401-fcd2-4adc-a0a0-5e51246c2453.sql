CREATE OR REPLACE FUNCTION public.reset_production_business_data(p_confirm text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := false;
  v_summary jsonb := '{}'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_computed jsonb := '{}'::jsonb;
  v_agent_related jsonb := '[]'::jsonb;
  v_count bigint;
  v_remaining_agent_payment_splits bigint := 0;
  v_agent_opening_balances bigint := 0;
  v_agent_adjustments bigint := 0;
  v_remaining_total bigint := 0;
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: يجب تسجيل الدخول';
  END IF;

  SELECT public.has_role(p_user_id, 'admin'::public.app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: صلاحيات المسؤول مطلوبة';
  END IF;

  IF p_confirm IS DISTINCT FROM 'تهيئة الإنتاج نهائياً' THEN
    RAISE EXCEPTION 'CONFIRM_MISMATCH: عبارة التأكيد غير مطابقة';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY table_name), '[]'::jsonb)
    INTO v_agent_related
  FROM (
    SELECT DISTINCT table_name, reason, foreign_key
    FROM (
      SELECT c.table_name::text,
             'has_agent_id_column'::text AS reason,
             NULL::text AS foreign_key
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.column_name = 'agent_id'
        AND c.table_name <> 'profiles'
      UNION ALL
      SELECT cls.relname::text AS table_name,
             'fk_references_agents'::text AS reason,
             con.conname::text AS foreign_key
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cls.relnamespace
      WHERE n.nspname = 'public'
        AND con.contype = 'f'
        AND con.confrelid = 'public.agents'::regclass
      UNION ALL
      SELECT cls.relname::text AS table_name,
             'fk_references_transactions'::text AS reason,
             con.conname::text AS foreign_key
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = cls.relnamespace
      WHERE n.nspname = 'public'
        AND con.contype = 'f'
        AND con.confrelid = 'public.transactions'::regclass
    ) d
  ) x;

  FOREACH t IN ARRAY wipe_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_count;
    v_before := v_before || jsonb_build_object(t, v_count);
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.payment_splits ps
  WHERE ps.transaction_id IS NOT NULL
     OR (ps.source_table = 'transactions' AND ps.source_id IS NOT NULL);
  v_before := v_before || jsonb_build_object('agent_payment_splits', v_count);

  EXECUTE 'ALTER TABLE public.payment_splits DISABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.cash_boxes DISABLE TRIGGER USER';

  FOREACH t IN ARRAY wipe_tables LOOP
    EXECUTE format('DELETE FROM public.%I', t);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_deleted := v_deleted || jsonb_build_object(t, v_count);
  END LOOP;

  UPDATE public.cash_boxes
     SET balance         = 0,
         opening_balance = 0,
         opening_date    = NULL,
         opening_note    = NULL,
         updated_at      = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('cash_boxes_reset', v_count);

  EXECUTE 'ALTER TABLE public.payment_splits ENABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.cash_boxes ENABLE TRIGGER USER';

  FOREACH t IN ARRAY wipe_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_count;
    v_after := v_after || jsonb_build_object(t, v_count);
  END LOOP;

  SELECT count(*) INTO v_remaining_agent_payment_splits
  FROM public.payment_splits ps
  WHERE ps.transaction_id IS NOT NULL
     OR (ps.source_table = 'transactions' AND ps.source_id IS NOT NULL);

  SELECT count(*) INTO v_agent_opening_balances
  FROM public.transactions
  WHERE source_service_type IN ('opening_debit', 'opening_credit')
     OR source_service_id IN (SELECT id::text FROM public.agents);

  SELECT count(*) INTO v_agent_adjustments
  FROM public.transactions
  WHERE source_service_type IN ('payment', 'agent_cash_out', 'merchant_cash_out_to_agent')
     OR (agent_id IS NOT NULL AND COALESCE(price, 0) = 0 AND (COALESCE(total_paid, 0) <> 0 OR COALESCE(paid, 0) <> 0));

  v_after := v_after || jsonb_build_object(
    'agent_payment_splits', v_remaining_agent_payment_splits,
    'agent_opening_balances', v_agent_opening_balances,
    'agent_adjustments', v_agent_adjustments
  );

  v_computed := jsonb_build_object(
    'agentCount', (SELECT count(*) FROM public.agents),
    'services', COALESCE((
      SELECT jsonb_object_agg(currency, amount)
      FROM (
        SELECT COALESCE(currency, 'EGP') AS currency,
               SUM(COALESCE(price, 0) * COALESCE(count, 1)) AS amount
        FROM public.transactions
        WHERE cancelled_at IS NULL
          AND agent_id IS NOT NULL
          AND COALESCE(price, 0) <> 0
        GROUP BY COALESCE(currency, 'EGP')
      ) s
      WHERE amount <> 0
    ), '{}'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_object_agg(currency, amount)
      FROM (
        SELECT COALESCE(currency, 'EGP') AS currency,
               SUM(COALESCE(instapay_amount, 0)
                 + COALESCE(cash_amount, 0)
                 + COALESCE(merchant_cash_net_amount, 0)
                 + COALESCE(merchant_cash_physical_amount, 0)) AS amount
        FROM public.transactions
        WHERE cancelled_at IS NULL
          AND agent_id IS NOT NULL
        GROUP BY COALESCE(currency, 'EGP')
      ) p
      WHERE amount <> 0
    ), '{}'::jsonb),
    'due', '{}'::jsonb
  );

  v_remaining_total :=
      COALESCE((v_after->>'agents')::bigint, 0)
    + COALESCE((v_after->>'transactions')::bigint, 0)
    + COALESCE((v_after->>'executions')::bigint, 0)
    + COALESCE((v_after->>'submissions')::bigint, 0)
    + COALESCE(v_remaining_agent_payment_splits, 0)
    + COALESCE(v_agent_opening_balances, 0)
    + COALESCE(v_agent_adjustments, 0);

  IF v_remaining_total <> 0
     OR (v_computed->>'agentCount')::bigint <> 0
     OR v_computed->'services' <> '{}'::jsonb
     OR v_computed->'payments' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'RESET_VERIFICATION_FAILED: %', jsonb_build_object(
      'remaining', v_after,
      'computed', v_computed,
      'agent_related_tables', v_agent_related
    )::text;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'before', v_before,
    'deleted', v_deleted,
    'remaining', jsonb_build_object(
      'agents', COALESCE((v_after->>'agents')::bigint, 0),
      'transactions', COALESCE((v_after->>'transactions')::bigint, 0),
      'agent_payment_splits', COALESCE(v_remaining_agent_payment_splits, 0),
      'executions', COALESCE((v_after->>'executions')::bigint, 0),
      'submissions', COALESCE((v_after->>'submissions')::bigint, 0),
      'agent_opening_balances', COALESCE(v_agent_opening_balances, 0),
      'agent_adjustments', COALESCE(v_agent_adjustments, 0)
    ),
    'computed', v_computed,
    'agent_related_tables', v_agent_related,
    'tables_after', v_after
  );
EXCEPTION WHEN OTHERS THEN
  BEGIN EXECUTE 'ALTER TABLE public.payment_splits ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.cash_boxes ENABLE TRIGGER USER'; EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_production_business_data(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_production_business_data(text) FROM anon;
REVOKE ALL ON FUNCTION public.reset_production_business_data(text) FROM authenticated;
DROP FUNCTION IF EXISTS public.reset_production_business_data(text);

REVOKE ALL ON FUNCTION public.reset_production_business_data(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_production_business_data(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reset_production_business_data(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_production_business_data(text, uuid) TO service_role;