-- ============================================================================
-- Harden execute_financial_atomic
--
-- Guarantees added here:
--   1) deterministic row ids may only be reused with the SAME normalized data;
--   2) payment_splits can explicitly require a cash box;
--   3) linked cash boxes are locked and validated inside the same DB transaction;
--   4) outflows are checked against the locked current balance immediately before
--      INSERT, so concurrent saves cannot both spend the same balance;
--   5) any failure raises an exception and PostgreSQL rolls back EVERY row and
--      every trigger side-effect in the logical financial operation.
-- ============================================================================

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
  v_row_count integer := 0;
  v_normalized_row jsonb;
  v_normalized_subset jsonb;
  v_existing_row jsonb;
  v_require_cash_box boolean := false;
  v_cash_box_id uuid;
  v_split_amount numeric;
  v_split_direction text;
  v_split_currency text;
  v_box_currency text;
  v_box_balance numeric;
  v_box_active boolean;
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

  -- Serialize duplicate clicks/retries for the same logical operation.
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
    v_require_cash_box := COALESCE(
      CASE WHEN v_step ? 'require_cash_box' THEN (v_step ->> 'require_cash_box')::boolean END,
      CASE WHEN v_step ? 'requireCashBox' THEN (v_step ->> 'requireCashBox')::boolean END,
      false
    );

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

    -- Normalize through the actual PostgreSQL composite type before comparing
    -- retries. This avoids false mismatches such as numeric 1 vs 1.0 or UUID/date
    -- textual formatting differences.
    EXECUTE format(
      'SELECT to_jsonb(x) FROM jsonb_populate_record(NULL::public.%I, $1) AS x',
      v_table
    ) INTO v_normalized_row USING v_row;

    SELECT COALESCE(jsonb_object_agg(k.key, v_normalized_row -> k.key), '{}'::jsonb)
      INTO v_normalized_subset
    FROM jsonb_object_keys(v_row) AS k(key);

    EXECUTE format(
      'SELECT to_jsonb(t) FROM public.%I AS t WHERE t.id = $1',
      v_table
    ) INTO v_existing_row USING v_row_id;

    IF v_existing_row IS NOT NULL THEN
      -- A deterministic id is safe to reuse ONLY if all supplied values match.
      -- Otherwise a retry/collision must fail rather than silently accepting a
      -- different financial row.
      IF NOT (v_normalized_subset <@ v_existing_row) THEN
        RAISE EXCEPTION 'تعذر تأكيد العملية: السطر % في الجدول % موجود ببيانات مختلفة', v_row_id, v_table;
      END IF;

      v_row_count := v_row_count + 1;
      CONTINUE;
    END IF;

    IF v_table = 'payment_splits' THEN
      v_split_amount := COALESCE((v_normalized_row ->> 'amount')::numeric, 0);
      v_split_direction := COALESCE(v_normalized_row ->> 'direction', 'in');
      v_split_currency := v_normalized_row ->> 'currency';
      v_cash_box_id := NULLIF(v_normalized_row ->> 'cash_box_id', '')::uuid;

      IF v_split_amount <= 0 THEN
        RAISE EXCEPTION 'قيمة الحركة المالية يجب أن تكون أكبر من صفر';
      END IF;

      IF v_split_direction NOT IN ('in', 'out') THEN
        RAISE EXCEPTION 'اتجاه الحركة المالية غير صالح: %', v_split_direction;
      END IF;

      IF v_split_currency NOT IN ('EGP', 'USD', 'LYD') THEN
        RAISE EXCEPTION 'عملة الحركة المالية غير صالحة: %', COALESCE(v_split_currency, 'NULL');
      END IF;

      IF v_require_cash_box AND v_cash_box_id IS NULL THEN
        RAISE EXCEPTION 'تم إيقاف العملية بالكامل: سطر مالي خاص بخزنة الشركة/الخزينة غير مربوط بخزنة';
      END IF;

      IF v_cash_box_id IS NOT NULL THEN
        -- Lock the current cash-box row until COMMIT/ROLLBACK. Two concurrent
        -- outflows therefore cannot both validate against the same old balance.
        SELECT cb.currency, COALESCE(cb.balance, 0), COALESCE(cb.is_active, true)
          INTO v_box_currency, v_box_balance, v_box_active
        FROM public.cash_boxes cb
        WHERE cb.id = v_cash_box_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'الخزنة المرتبطة بالحركة غير موجودة: %', v_cash_box_id;
        END IF;

        IF NOT v_box_active THEN
          RAISE EXCEPTION 'الخزنة المرتبطة بالحركة غير مفعلة';
        END IF;

        IF v_box_currency IS DISTINCT FROM v_split_currency THEN
          RAISE EXCEPTION 'عملة الخزنة (%) لا تطابق عملة الحركة (%)', v_box_currency, v_split_currency;
        END IF;

        IF v_split_direction = 'out' AND v_box_balance < v_split_amount THEN
          RAISE EXCEPTION 'الرصيد الحالي بالخزنة غير كافٍ لإتمام العملية';
        END IF;
      END IF;
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

    -- No ON CONFLICT DO NOTHING here: a concurrent/different id collision must
    -- abort the whole transaction. A legitimate retry is handled by the exact
    -- normalized-row comparison above.
    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) '
      'SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I, $1) AS x',
      v_table,
      v_cols,
      v_select_cols
    ) USING v_row;

    v_row_count := v_row_count + 1;
  END LOOP;

  -- Written last. If any validation/INSERT/trigger above fails, this row and all
  -- financial effects are rolled back together. If the HTTP response is lost
  -- AFTER COMMIT, retrying the same operation id returns this stored result.
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
