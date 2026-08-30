-- ============================================================================
-- Atomic mutation RPCs for existing financial transactions.
-- Parent + related payment_splits are changed inside ONE PostgreSQL transaction.
-- If any UPDATE/trigger/constraint fails, PostgreSQL rolls back the whole change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_financial_cancel_state_atomic(
  p_table text,
  p_id uuid,
  p_cancel boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_cancelled_at timestamptz;
  v_prefix_table text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'معرّف الحركة مطلوب';
  END IF;
  IF p_table NOT IN (
    'transactions',
    'company_transactions',
    'currency_supplier_transactions',
    'expense_deductions',
    'usd_treasury_transactions',
    'merchant_cash_collections',
    'payment_splits'
  ) THEN
    RAISE EXCEPTION 'جدول مالي غير مسموح به: %', COALESCE(p_table, 'NULL');
  END IF;
  IF p_cancel AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_table || ':' || p_id::text, 0));

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1 FOR UPDATE', p_table)
    INTO v_before USING p_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'الحركة غير موجودة';
  END IF;

  IF p_cancel THEN
    IF NULLIF(v_before ->> 'cancelled_at', '') IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'reused', true, 'before', v_before, 'after', v_before);
    END IF;

    v_cancelled_at := clock_timestamp();

    IF p_table = 'payment_splits' THEN
      UPDATE public.payment_splits
         SET cancelled_at = v_cancelled_at,
             cancelled_by = v_user_id,
             cancel_reason = btrim(p_reason)
       WHERE id = p_id
         AND cancelled_at IS NULL;
    ELSE
      -- Treasury effect is reversed by payment_splits_balance_sync. Because this
      -- runs in the same DB transaction as the parent UPDATE, there is no state
      -- where one side can commit without the other.
      UPDATE public.payment_splits
         SET cancelled_at = v_cancelled_at,
             cancelled_by = v_user_id,
             cancel_reason = btrim(p_reason)
       WHERE source_table = p_table
         AND source_id = p_id
         AND cancelled_at IS NULL;

      EXECUTE format(
        'UPDATE public.%I SET cancelled_at = $2, cancelled_by = $3, cancel_reason = $4 WHERE id = $1',
        p_table
      ) USING p_id, v_cancelled_at, v_user_id, btrim(p_reason);
    END IF;
  ELSE
    IF NULLIF(v_before ->> 'cancelled_at', '') IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'reused', true, 'before', v_before, 'after', v_before);
    END IF;

    IF p_table = 'payment_splits' THEN
      UPDATE public.payment_splits
         SET cancelled_at = NULL,
             cancelled_by = NULL,
             cancel_reason = NULL
       WHERE id = p_id;
    ELSE
      UPDATE public.payment_splits
         SET cancelled_at = NULL,
             cancelled_by = NULL,
             cancel_reason = NULL
       WHERE source_table = p_table
         AND source_id = p_id;

      EXECUTE format(
        'UPDATE public.%I SET cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL WHERE id = $1',
        p_table
      ) USING p_id;
    END IF;
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', p_table)
    INTO v_after USING p_id;
  IF v_after IS NULL THEN
    RAISE EXCEPTION 'تعذر تأكيد حالة الحركة بعد التعديل';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'before', v_before,
    'after', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_financial_cancel_state_atomic(text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_financial_cancel_state_atomic(text, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_financial_cancel_state_atomic(text, uuid, boolean, text)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.update_financial_transaction_atomic(
  p_table text,
  p_id uuid,
  p_parent_patch jsonb DEFAULT '{}'::jsonb,
  p_split_patches jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_patch jsonb;
  v_split_id uuid;
  v_set_sql text;
  v_unknown_cols text;
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'معرّف الحركة مطلوب';
  END IF;
  IF p_table NOT IN (
    'transactions',
    'company_transactions',
    'currency_supplier_transactions',
    'expense_deductions',
    'usd_treasury_transactions',
    'merchant_cash_collections',
    'payment_splits'
  ) THEN
    RAISE EXCEPTION 'جدول مالي غير مسموح به: %', COALESCE(p_table, 'NULL');
  END IF;
  IF jsonb_typeof(COALESCE(p_parent_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'تعديلات الحركة غير صالحة';
  END IF;
  IF jsonb_typeof(COALESCE(p_split_patches, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'تعديلات الخزينة غير صالحة';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_table || ':' || p_id::text, 0));

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1 FOR UPDATE', p_table)
    INTO v_before USING p_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'الحركة غير موجودة';
  END IF;
  IF NULLIF(v_before ->> 'cancelled_at', '') IS NOT NULL THEN
    RAISE EXCEPTION 'لا يمكن تعديل حركة ملغاة';
  END IF;

  -- Lock all referenced split rows before changing any amount. This serialises
  -- simultaneous edits/cancellations of the same treasury rows.
  FOR v_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_split_patches, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_patch) <> 'object' OR NOT (v_patch ? 'id') THEN
      RAISE EXCEPTION 'تعديل payment_split غير صالح';
    END IF;
    v_split_id := (v_patch ->> 'id')::uuid;
    PERFORM 1 FROM public.payment_splits WHERE id = v_split_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'قيد الخزينة غير موجود: %', v_split_id;
    END IF;
  END LOOP;

  -- Apply payment_split patches. UPDATE trigger reverses the old cash-box effect
  -- and applies the new effect inside this same database transaction.
  FOR v_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_split_patches, '[]'::jsonb))
  LOOP
    v_split_id := (v_patch ->> 'id')::uuid;

    SELECT string_agg(k.key, ', ' ORDER BY k.key)
      INTO v_unknown_cols
    FROM jsonb_object_keys(v_patch) AS k(key)
    WHERE k.key <> 'id'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = 'payment_splits'
           AND c.column_name = k.key
           AND c.is_generated = 'NEVER'
           AND COALESCE(c.is_identity, 'NO') = 'NO'
      );
    IF v_unknown_cols IS NOT NULL THEN
      RAISE EXCEPTION 'أعمدة payment_split غير معروفة: %', v_unknown_cols;
    END IF;

    SELECT string_agg(format('%1$I = x.%1$I', k.key), ', ' ORDER BY k.key)
      INTO v_set_sql
    FROM jsonb_object_keys(v_patch) AS k(key)
    WHERE k.key <> 'id';

    IF v_set_sql IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.payment_splits p SET %s '
        'FROM jsonb_populate_record(NULL::public.payment_splits, $1) x '
        'WHERE p.id = $2',
        v_set_sql
      ) USING v_patch, v_split_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated <> 1 THEN
        RAISE EXCEPTION 'تعذر تحديث قيد الخزينة: %', v_split_id;
      END IF;
    END IF;
  END LOOP;

  IF p_table <> 'payment_splits' AND p_parent_patch <> '{}'::jsonb THEN
    SELECT string_agg(k.key, ', ' ORDER BY k.key)
      INTO v_unknown_cols
    FROM jsonb_object_keys(p_parent_patch) AS k(key)
    WHERE k.key = 'id'
       OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = p_table
           AND c.column_name = k.key
           AND c.is_generated = 'NEVER'
           AND COALESCE(c.is_identity, 'NO') = 'NO'
      );
    IF v_unknown_cols IS NOT NULL THEN
      RAISE EXCEPTION 'أعمدة غير معروفة في الجدول %: %', p_table, v_unknown_cols;
    END IF;

    SELECT string_agg(format('%1$I = x.%1$I', k.key), ', ' ORDER BY k.key)
      INTO v_set_sql
    FROM jsonb_object_keys(p_parent_patch) AS k(key);

    IF v_set_sql IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%1$I p SET %2$s '
        'FROM jsonb_populate_record(NULL::public.%1$I, $1) x '
        'WHERE p.id = $2',
        p_table, v_set_sql
      ) USING p_parent_patch, p_id;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated <> 1 THEN
        RAISE EXCEPTION 'تعذر تحديث الحركة المالية';
      END IF;
    END IF;
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', p_table)
    INTO v_after USING p_id;

  RETURN jsonb_build_object('ok', true, 'before', v_before, 'after', COALESCE(v_after, v_before));
END;
$$;

REVOKE ALL ON FUNCTION public.update_financial_transaction_atomic(text, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_financial_transaction_atomic(text, uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_financial_transaction_atomic(text, uuid, jsonb, jsonb)
  TO authenticated, service_role;
