-- ============================================================================
-- Atomic financial writes + durable idempotency
--
-- One RPC call = one PostgreSQL transaction. If any row insert, constraint,
-- RLS policy, or payment_splits trigger fails, PostgreSQL rolls back the whole
-- operation, including cash-box balance changes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.financial_operation_requests (
  operation_id uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_operation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_operation_requests_select_own
  ON public.financial_operation_requests;
CREATE POLICY financial_operation_requests_select_own
  ON public.financial_operation_requests
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS financial_operation_requests_insert_own
  ON public.financial_operation_requests;
CREATE POLICY financial_operation_requests_insert_own
  ON public.financial_operation_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

GRANT SELECT, INSERT ON public.financial_operation_requests TO authenticated;
GRANT ALL ON public.financial_operation_requests TO service_role;

CREATE OR REPLACE FUNCTION public.execute_financial_atomic(
  p_operation_id uuid,
  p_fingerprint text,
  p_rows jsonb,
  p_result jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_saved_fingerprint text;
  v_saved_result jsonb;
  v_step jsonb;
  v_table text;
  v_row jsonb;
  v_cols text;
  v_select_cols text;
  v_unknown_cols text;
  v_row_id uuid;
  v_exists boolean;
  v_row_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ حركة مالية';
  END IF;

  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية المالية مطلوب';
  END IF;

  IF COALESCE(btrim(p_fingerprint), '') = '' THEN
    RAISE EXCEPTION 'بصمة العملية المالية مطلوبة';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'لا توجد سطور مالية للحفظ';
  END IF;

  -- Serialise retries/concurrent clicks for this logical operation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  SELECT r.fingerprint, r.result
    INTO v_saved_fingerprint, v_saved_result
  FROM public.financial_operation_requests r
  WHERE r.operation_id = p_operation_id;

  IF FOUND THEN
    IF v_saved_fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'تم استخدام معرّف العملية سابقاً ببيانات مختلفة';
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'reused', true,
      'result', COALESCE(v_saved_result, '{}'::jsonb)
    );
  END IF;

  FOR v_step IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_table := v_step ->> 'table';
    v_row := v_step -> 'row';

    IF v_table IS NULL OR v_table NOT IN (
      'transactions',
      'company_transactions',
      'payment_splits',
      'expenses',
      'expense_deductions',
      'merchant_cash_collections',
      'investor_transactions',
      'currency_supplier_transactions',
      'cash_transfers'
    ) THEN
      RAISE EXCEPTION 'جدول مالي غير مسموح به: %', COALESCE(v_table, 'NULL');
    END IF;

    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'بيانات السطر المالي غير صالحة للجدول %', v_table;
    END IF;

    IF NOT (v_row ? 'id') OR COALESCE(v_row ->> 'id', '') = '' THEN
      RAISE EXCEPTION 'كل سطر مالي يجب أن يحتوي على id ثابت';
    END IF;

    BEGIN
      v_row_id := (v_row ->> 'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'id غير صالح في الجدول %', v_table;
    END;

    SELECT string_agg(k.key, ', ' ORDER BY k.key)
      INTO v_unknown_cols
    FROM jsonb_object_keys(v_row) AS k(key)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = v_table
        AND c.column_name = k.key
    );

    IF v_unknown_cols IS NOT NULL THEN
      RAISE EXCEPTION 'أعمدة غير معروفة في الجدول %: %', v_table, v_unknown_cols;
    END IF;

    SELECT
      string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position),
      string_agg(format('x.%I', c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO v_cols, v_select_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = v_table
      AND c.is_generated = 'NEVER'
      AND COALESCE(c.is_identity, 'NO') = 'NO'
      AND (v_row ? c.column_name);

    IF v_cols IS NULL OR v_select_cols IS NULL THEN
      RAISE EXCEPTION 'لا توجد أعمدة صالحة للحفظ في الجدول %', v_table;
    END IF;

    -- jsonb_populate_record performs the same PostgreSQL type coercion as a
    -- normal INSERT. ON CONFLICT makes a deterministic retry safe. Any later
    -- error in this function rolls this INSERT (and trigger side-effects) back.
    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) '
      'SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I, $1) AS x '
      'ON CONFLICT (id) DO NOTHING',
      v_table,
      v_cols,
      v_select_cols
    ) USING v_row;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)',
      v_table
    ) INTO v_exists USING v_row_id;

    IF NOT COALESCE(v_exists, false) THEN
      RAISE EXCEPTION 'تعذر تأكيد السطر المالي في الجدول %', v_table;
    END IF;

    v_row_count := v_row_count + 1;
  END LOOP;

  -- This row is written last. If anything above fails, this INSERT and every
  -- financial row/trigger change are rolled back together. If the HTTP response
  -- is lost after COMMIT, a retry finds this row and returns the same result.
  INSERT INTO public.financial_operation_requests (
    operation_id,
    fingerprint,
    result,
    created_by
  ) VALUES (
    p_operation_id,
    p_fingerprint,
    COALESCE(p_result, '{}'::jsonb),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'rows', v_row_count,
    'result', COALESCE(p_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_financial_atomic(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_financial_atomic(uuid, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_financial_atomic(uuid, text, jsonb, jsonb)
  TO authenticated, service_role;
