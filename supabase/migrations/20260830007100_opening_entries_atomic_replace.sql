-- Atomic full-replace for entity opening ledger entries.
CREATE OR REPLACE FUNCTION public.replace_entity_opening_entries_atomic(
  p_kind text,
  p_entity_id uuid,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_entity_col text;
  v_step jsonb;
  v_cols text;
  v_select_cols text;
  v_unknown_cols text;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_entity_id IS NULL THEN RAISE EXCEPTION 'معرّف الحساب مطلوب'; END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'بيانات الرصيد الافتتاحي غير صالحة';
  END IF;

  CASE p_kind
    WHEN 'agent' THEN v_table := 'transactions'; v_entity_col := 'agent_id';
    WHEN 'company' THEN v_table := 'company_transactions'; v_entity_col := 'company_id';
    WHEN 'merchant' THEN v_table := 'merchant_cash_collections'; v_entity_col := 'merchant_id';
    WHEN 'currency_supplier' THEN v_table := 'currency_supplier_transactions'; v_entity_col := 'supplier_id';
    ELSE RAISE EXCEPTION 'نوع حساب غير مسموح به: %', COALESCE(p_kind, 'NULL');
  END CASE;

  PERFORM pg_advisory_xact_lock(hashtextextended('opening:' || p_kind || ':' || p_entity_id::text, 0));

  EXECUTE format(
    'DELETE FROM public.%I WHERE %I = $1 AND source_service_type IN (''opening_debit'', ''opening_credit'')',
    v_table, v_entity_col
  ) USING p_entity_id;

  FOR v_step IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_step) <> 'object' THEN RAISE EXCEPTION 'سطر رصيد افتتاحي غير صالح'; END IF;

    SELECT string_agg(k.key, ', ' ORDER BY k.key)
      INTO v_unknown_cols
    FROM jsonb_object_keys(v_step) AS k(key)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = v_table
        AND c.column_name = k.key
    );
    IF v_unknown_cols IS NOT NULL THEN
      RAISE EXCEPTION 'أعمدة غير معروفة في %: %', v_table, v_unknown_cols;
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
      AND (v_step ? c.column_name);

    IF v_cols IS NULL THEN RAISE EXCEPTION 'لا توجد بيانات صالحة لسطر الرصيد الافتتاحي'; END IF;

    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I, $1) x',
      v_table, v_cols, v_select_cols
    ) USING v_step;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rows', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_entity_opening_entries_atomic(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_entity_opening_entries_atomic(text, uuid, jsonb) TO authenticated, service_role;
