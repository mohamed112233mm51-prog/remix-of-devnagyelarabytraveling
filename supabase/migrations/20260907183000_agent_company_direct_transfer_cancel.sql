-- Direct agent -> issuing-company settlement.
-- Two linked ledger rows, intentionally without payment_splits/cash-box movement.

DROP POLICY IF EXISTS transactions_perm_insert ON public.transactions;
CREATE POLICY transactions_perm_insert ON public.transactions
FOR INSERT TO authenticated WITH CHECK (
  public.app_permission_allowed('accounts','create')
  OR (agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_permission_allowed('merchants','create'))
  OR (
    source_service_type = 'execution'
    AND public.app_permission_allowed('executions','edit')
    AND EXISTS (
      SELECT 1 FROM public.executions e
      WHERE e.id::text = split_part(COALESCE(source_service_id,''), '::', 1)
    )
  )
  OR (
    source_service_type = 'merchant_cash_out_to_company'
    AND agent_id IS NULL AND merchant_id IS NOT NULL
    AND public.app_permission_allowed('companies','create')
  )
  OR (
    source_service_type = 'merchant_cash_out_to_agent'
    AND agent_id IS NULL AND merchant_id IS NOT NULL
    AND public.app_permission_allowed('accounts','create')
  )
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
  OR (
    source_service_type IN ('opening_debit','opening_credit')
    AND public.app_permission_allowed('accounts','edit')
  )
  OR (
    source_service_type = 'agent_direct_to_company'
    AND agent_id IS NOT NULL
    AND merchant_id IS NULL
    AND public.app_permission_allowed('companies','create')
    AND EXISTS (
      SELECT 1 FROM public.company_transactions ct
      WHERE ct.id::text = COALESCE(public.transactions.source_service_id, '')
        AND ct.source_service_type = 'agent_direct_to_company'
        AND COALESCE(ct.source_service_id, '') = public.transactions.id::text
        AND ct.cancelled_at IS NULL
    )
  )
);

CREATE OR REPLACE FUNCTION public.set_agent_company_direct_cancel_state_atomic(
  p_table text,
  p_id uuid,
  p_cancel boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_source_type text;
  v_source_id text;
  v_counterpart_id uuid;
  v_parent_before jsonb;
  v_parent_after jsonb;
  v_counter_before jsonb;
  v_counter_after jsonb;
  v_counter_table text;
  v_now timestamptz := now();
  v_reused boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501';
  END IF;
  IF p_table NOT IN ('transactions', 'company_transactions') THEN
    RAISE EXCEPTION 'نوع الحركة غير مدعوم';
  END IF;
  IF p_cancel AND v_reason IS NULL THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب';
  END IF;

  IF p_table = 'transactions' THEN
    IF NOT public.app_financial_action_allowed('accounts', 'delete') THEN
      RAISE EXCEPTION 'لا تملك صلاحية إلغاء حركة الوكيل' USING ERRCODE = '42501';
    END IF;
    SELECT t.source_service_type, t.source_service_id
      INTO v_source_type, v_source_id
      FROM public.transactions t WHERE t.id = p_id;
    v_counter_table := 'company_transactions';
  ELSE
    IF NOT public.app_financial_action_allowed('companies', 'delete') THEN
      RAISE EXCEPTION 'لا تملك صلاحية إلغاء حركة الشركة' USING ERRCODE = '42501';
    END IF;
    SELECT ct.source_service_type, ct.source_service_id
      INTO v_source_type, v_source_id
      FROM public.company_transactions ct WHERE ct.id = p_id;
    v_counter_table := 'transactions';
  END IF;

  IF v_source_type IS DISTINCT FROM 'agent_direct_to_company' OR NULLIF(v_source_id, '') IS NULL THEN
    RAISE EXCEPTION 'الحركة ليست تحويلاً مباشراً مرتبطاً بين وكيل وشركة';
  END IF;
  BEGIN
    v_counterpart_id := v_source_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'رابط الطرف المقابل غير صالح';
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(LEAST(p_id::text, v_counterpart_id::text) || '|' || GREATEST(p_id::text, v_counterpart_id::text), 0)
  );

  IF p_table = 'transactions' THEN
    SELECT to_jsonb(t) INTO v_parent_before FROM public.transactions t WHERE t.id = p_id FOR UPDATE;
    SELECT to_jsonb(ct) INTO v_counter_before FROM public.company_transactions ct WHERE ct.id = v_counterpart_id FOR UPDATE;
  ELSE
    SELECT to_jsonb(ct) INTO v_parent_before FROM public.company_transactions ct WHERE ct.id = p_id FOR UPDATE;
    SELECT to_jsonb(t) INTO v_counter_before FROM public.transactions t WHERE t.id = v_counterpart_id FOR UPDATE;
  END IF;

  IF v_parent_before IS NULL OR v_counter_before IS NULL THEN
    RAISE EXCEPTION 'أحد طرفي التحويل المباشر غير موجود';
  END IF;
  IF COALESCE(v_parent_before->>'source_service_type', '') <> 'agent_direct_to_company'
     OR COALESCE(v_counter_before->>'source_service_type', '') <> 'agent_direct_to_company'
     OR COALESCE(v_parent_before->>'source_service_id', '') <> v_counterpart_id::text
     OR COALESCE(v_counter_before->>'source_service_id', '') <> p_id::text THEN
    RAISE EXCEPTION 'رابط التحويل المباشر بين الطرفين غير متطابق';
  END IF;

  v_reused := CASE
    WHEN p_cancel THEN (v_parent_before->>'cancelled_at') IS NOT NULL AND (v_counter_before->>'cancelled_at') IS NOT NULL
    ELSE (v_parent_before->>'cancelled_at') IS NULL AND (v_counter_before->>'cancelled_at') IS NULL
  END;

  IF NOT v_reused THEN
    IF p_table = 'transactions' THEN
      UPDATE public.transactions SET
        cancelled_at = CASE WHEN p_cancel THEN v_now ELSE NULL END,
        cancelled_by = CASE WHEN p_cancel THEN v_actor ELSE NULL END,
        cancel_reason = CASE WHEN p_cancel THEN v_reason ELSE NULL END
      WHERE id = p_id;
      UPDATE public.company_transactions SET
        cancelled_at = CASE WHEN p_cancel THEN v_now ELSE NULL END,
        cancelled_by = CASE WHEN p_cancel THEN v_actor ELSE NULL END,
        cancel_reason = CASE WHEN p_cancel THEN v_reason ELSE NULL END
      WHERE id = v_counterpart_id;
    ELSE
      UPDATE public.company_transactions SET
        cancelled_at = CASE WHEN p_cancel THEN v_now ELSE NULL END,
        cancelled_by = CASE WHEN p_cancel THEN v_actor ELSE NULL END,
        cancel_reason = CASE WHEN p_cancel THEN v_reason ELSE NULL END
      WHERE id = p_id;
      UPDATE public.transactions SET
        cancelled_at = CASE WHEN p_cancel THEN v_now ELSE NULL END,
        cancelled_by = CASE WHEN p_cancel THEN v_actor ELSE NULL END,
        cancel_reason = CASE WHEN p_cancel THEN v_reason ELSE NULL END
      WHERE id = v_counterpart_id;
    END IF;
  END IF;

  IF p_table = 'transactions' THEN
    SELECT to_jsonb(t) INTO v_parent_after FROM public.transactions t WHERE t.id = p_id;
    SELECT to_jsonb(ct) INTO v_counter_after FROM public.company_transactions ct WHERE ct.id = v_counterpart_id;
  ELSE
    SELECT to_jsonb(ct) INTO v_parent_after FROM public.company_transactions ct WHERE ct.id = p_id;
    SELECT to_jsonb(t) INTO v_counter_after FROM public.transactions t WHERE t.id = v_counterpart_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reused', v_reused,
    'before', v_parent_before,
    'after', v_parent_after,
    'counterpart_before', v_counter_before,
    'counterpart_after', v_counter_after,
    'counterpart_table', v_counter_table,
    'counterpart_id', v_counterpart_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_agent_company_direct_cancel_state_atomic(text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_agent_company_direct_cancel_state_atomic(text, uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_agent_company_direct_cancel_state_atomic(text, uuid, boolean, text)
TO authenticated, service_role;
