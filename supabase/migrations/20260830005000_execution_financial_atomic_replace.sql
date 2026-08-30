-- Atomic replacement of execution-generated financial metadata rows.
-- Delete old linked rows + persist posting date + insert new rows are one DB tx.

CREATE OR REPLACE FUNCTION public.replace_execution_financials_atomic(
  p_operation_id uuid,
  p_fingerprint text,
  p_execution_id uuid,
  p_financial_posting_date date,
  p_rows jsonb DEFAULT '[]'::jsonb
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
  v_row_count integer := 0;
  v_prefix text;
  v_actual_date date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ حركة مالية';
  END IF;
  IF p_operation_id IS NULL OR p_execution_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية والتنفيذ مطلوبان';
  END IF;
  IF COALESCE(btrim(p_fingerprint), '') = '' THEN
    RAISE EXCEPTION 'بصمة العملية المالية مطلوبة';
  END IF;
  IF p_financial_posting_date IS NULL THEN
    RAISE EXCEPTION 'تاريخ القيد المالي مطلوب';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'سطور التنفيذ المالية غير صالحة';
  END IF;

  -- Serialize all rewrites for one execution and also serialize retries of the
  -- same logical operation.
  PERFORM pg_advisory_xact_lock(hashtextextended('execution:' || p_execution_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 1));

  SELECT r.fingerprint, r.result
    INTO v_saved_fingerprint, v_saved_result
  FROM public.financial_operation_requests r
  WHERE r.operation_id = p_operation_id;

  IF FOUND THEN
    IF v_saved_fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'تم استخدام معرّف العملية سابقاً ببيانات مختلفة';
    END IF;
    RETURN jsonb_build_object('ok', true, 'reused', true, 'result', COALESCE(v_saved_result, '{}'::jsonb));
  END IF;

  -- Preserve the first accounting date. This UPDATE is part of the same tx as
  -- the replacement below, so a later failure rolls it back too.
  UPDATE public.executions
     SET financial_posting_date = COALESCE(financial_posting_date, p_financial_posting_date)
   WHERE id = p_execution_id
   RETURNING financial_posting_date INTO v_actual_date;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'التنفيذ غير موجود';
  END IF;

  v_actual_date := COALESCE(v_actual_date, p_financial_posting_date);
  v_prefix := p_execution_id::text || '::%';

  -- If these parent rows ever gain payment_splits, transaction FK cascades and
  -- payment_splits triggers execute inside this same transaction as well.
  DELETE FROM public.transactions
   WHERE source_service_type = 'execution'
     AND source_service_id LIKE v_prefix;

  DELETE FROM public.company_transactions
   WHERE source_service_type = 'execution'
     AND source_service_id LIKE v_prefix;

  FOR v_step IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_table := v_step ->> 'table';
    v_row := v_step -> 'row';

    IF v_table NOT IN ('transactions', 'company_transactions') THEN
      RAISE EXCEPTION 'جدول تنفيذ مالي غير مسموح به: %', COALESCE(v_table, 'NULL');
    END IF;
    IF jsonb_typeof(v_row) <> 'object' OR NOT (v_row ? 'id') THEN
      RAISE EXCEPTION 'سطر التنفيذ المالي غير صالح';
    END IF;

    -- Force the immutable posting date selected by the DB.
    v_row := jsonb_set(v_row, '{date}', to_jsonb(v_actual_date::text), true);

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

    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) SELECT %3$s '
      'FROM jsonb_populate_record(NULL::public.%1$I, $1) AS x',
      v_table, v_cols, v_select_cols
    ) USING v_row;
    v_row_count := v_row_count + 1;
  END LOOP;

  INSERT INTO public.financial_operation_requests(operation_id, fingerprint, result, created_by)
  VALUES (
    p_operation_id,
    p_fingerprint,
    jsonb_build_object('executionId', p_execution_id, 'postingDate', v_actual_date, 'rows', v_row_count),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'result', jsonb_build_object('executionId', p_execution_id, 'postingDate', v_actual_date, 'rows', v_row_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_execution_financials_atomic(uuid, text, uuid, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_execution_financials_atomic(uuid, text, uuid, date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_execution_financials_atomic(uuid, text, uuid, date, jsonb)
  TO authenticated, service_role;
