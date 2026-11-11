-- Resolve the existing ledger references before mutating a financial operation.
-- Keep the public RPC signatures and the existing cash-box balance trigger.
CREATE SCHEMA IF NOT EXISTS financial_internal;
REVOKE ALL ON SCHEMA financial_internal FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA financial_internal TO authenticated, service_role;

ALTER TABLE public.investor_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $migration$
BEGIN
  IF to_regprocedure('financial_internal.update_financial_transaction_atomic(text,uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.update_financial_transaction_atomic(text, uuid, jsonb, jsonb) SET SCHEMA financial_internal;
  END IF;
  IF to_regprocedure('financial_internal.execute_financial_atomic(uuid,text,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.execute_financial_atomic(uuid, text, jsonb, jsonb) SET SCHEMA financial_internal;
  END IF;
END;
$migration$;

-- Resolve complete groups even when RLS hides one side from the caller.
-- Edit and insert retain RLS; cancellation authorizes the originating action
-- explicitly, as the existing paired agent/company cancellation already does.
CREATE OR REPLACE FUNCTION financial_internal.resolve_operation(p_table text, p_id uuid)
RETURNS TABLE (kind text, root_table text, root_id uuid, member_table text, member_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_table text := p_table;
  v_id uuid := p_id;
  v_kind text;
  v_type text;
  v_ref text;
  v_merchant uuid;
  v_other uuid;
  v_company uuid;
  v_expense uuid;
  v_entry public.payment_splits%ROWTYPE;
BEGIN
  IF p_table = 'payment_splits' THEN
    SELECT * INTO v_entry FROM public.payment_splits WHERE id = p_id;
    IF v_entry.source_table = 'cash_box_transfer' THEN
      IF v_entry.source_id IS NULL THEN RAISE EXCEPTION 'التحويل بدون رابط محفوظ'; END IF;
      RETURN QUERY SELECT 'transfer', 'cash_box_transfer', v_entry.source_id, 'payment_splits', s.id
        FROM public.payment_splits s WHERE s.source_table = 'cash_box_transfer' AND s.source_id = v_entry.source_id;
      RETURN;
    END IF;
    IF v_entry.source_table IN ('transactions','company_transactions','currency_supplier_transactions',
      'expenses','expense_deductions','merchant_cash_collections','usd_treasury_transactions','investor_transactions')
      OR v_entry.transaction_id IS NOT NULL THEN
      RETURN QUERY SELECT 'source_only', p_table, p_id, p_table, p_id;
      RETURN;
    END IF;
  ELSIF p_table = 'expense_deductions' THEN
    SELECT expense_id INTO v_expense FROM public.expense_deductions WHERE id = p_id;
  ELSIF p_table = 'merchant_cash_collections' THEN
    SELECT expense_id, source_service_type, source_service_id::text
      INTO v_expense, v_type, v_ref FROM public.merchant_cash_collections WHERE id = p_id;
    IF v_type = 'currency_supplier' AND v_expense IS NULL THEN
      v_table := 'currency_supplier_transactions';
      v_id := v_ref::uuid;
      IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.currency_supplier_transactions s WHERE s.id = v_id) THEN
        RAISE EXCEPTION 'قيد التاجر غير مرتبط بمورد عملة صالح';
      END IF;
    END IF;
  END IF;

  IF v_expense IS NOT NULL THEN
    RETURN QUERY SELECT 'source_only', p_table, p_id, p_table, p_id;
    RETURN;
  END IF;

  IF v_table = 'currency_supplier_transactions' THEN
    IF NOT EXISTS (SELECT 1 FROM public.currency_supplier_transactions s WHERE s.id = v_id) THEN RETURN; END IF;
    RETURN QUERY SELECT 'supplier', v_table, v_id, v_table, v_id
      UNION ALL SELECT 'supplier', v_table, v_id, 'merchant_cash_collections', c.id
      FROM public.merchant_cash_collections c
      WHERE c.expense_id IS NULL AND c.source_service_type = 'currency_supplier' AND c.source_service_id = v_id;
    RETURN;
  END IF;

  IF v_table = 'investor_transactions' THEN
    IF EXISTS (SELECT 1 FROM public.investor_transactions t WHERE t.id=v_id) THEN
      RETURN QUERY SELECT 'investor', v_table, v_id, v_table, v_id;
    END IF;
    RETURN;
  END IF;

  IF v_table = 'usd_treasury_transactions' THEN
    IF EXISTS (SELECT 1 FROM public.usd_treasury_transactions t WHERE t.id = v_id AND t.type = 'conversion') THEN
      RETURN QUERY SELECT 'conversion', v_table, v_id, v_table, v_id;
    END IF;
    RETURN;
  END IF;

  IF v_table = 'transactions' THEN
    SELECT t.source_service_type, t.source_service_id, t.merchant_id INTO v_type, v_ref, v_merchant
      FROM public.transactions t WHERE t.id = v_id;
  ELSIF v_table = 'company_transactions' THEN
    SELECT t.source_service_type, t.source_service_id, t.merchant_id INTO v_type, v_ref, v_merchant
      FROM public.company_transactions t WHERE t.id = v_id;
  ELSE
    RETURN;
  END IF;

  IF v_type IN ('execution','flight_ticket','security_approval','libyan_investment') THEN
    RETURN QUERY SELECT 'source_only', p_table, p_id, p_table, p_id;
    RETURN;
  END IF;

  IF v_type = 'agent_direct_to_company' THEN
    IF v_table = 'transactions' THEN
      v_other := v_id;
      SELECT t.id INTO v_company FROM public.company_transactions t
        WHERE t.id = NULLIF(v_ref,'')::uuid AND t.source_service_type = v_type AND t.source_service_id = v_other::text;
    ELSE
      v_company := v_id;
      SELECT t.id INTO v_other FROM public.transactions t
        WHERE t.id = NULLIF(v_ref,'')::uuid AND t.source_service_type = v_type AND t.source_service_id = v_company::text;
    END IF;
    IF v_other IS NULL OR v_company IS NULL THEN RAISE EXCEPTION 'أحد طرفي التحويل المباشر غير مرتبط'; END IF;
    RETURN QUERY SELECT 'direct', 'company_transactions', v_company, 'transactions', v_other
      UNION ALL SELECT 'direct', 'company_transactions', v_company, 'company_transactions', v_company;
    RETURN;
  END IF;

  IF v_type IN ('submission_fine','execution_fine') THEN
    IF NULLIF(v_ref,'') IS NULL THEN RAISE EXCEPTION 'الغرامة بدون رابط محفوظ'; END IF;
    SELECT t.id INTO v_other FROM public.transactions t
      WHERE t.source_service_type = v_type AND t.source_service_id = v_ref;
    SELECT t.id INTO v_company FROM public.company_transactions t
      WHERE t.source_service_type = v_type AND t.source_service_id = v_ref;
    IF v_other IS NULL OR v_company IS NULL
      OR (SELECT count(*) FROM public.transactions t WHERE t.source_service_type=v_type AND t.source_service_id=v_ref) <> 1
      OR (SELECT count(*) FROM public.company_transactions t WHERE t.source_service_type=v_type AND t.source_service_id=v_ref) <> 1 THEN
      RAISE EXCEPTION 'قيود طرفي الغرامة غير مكتملة أو مكررة';
    END IF;
    RETURN QUERY SELECT 'fine', 'company_transactions', v_company, 'transactions', v_other
      UNION ALL SELECT 'fine', 'company_transactions', v_company, 'company_transactions', v_company;
    RETURN;
  END IF;

  IF v_type IN ('merchant_cash_out_to_agent','merchant_cash_out_to_company') THEN
    IF v_table <> 'transactions' OR v_merchant IS NULL OR NULLIF(v_ref,'') IS NULL THEN
      RAISE EXCEPTION 'قيد التاجر بدون رابط محفوظ';
    END IF;
    v_id := v_ref::uuid;
    v_table := CASE v_type WHEN 'merchant_cash_out_to_agent' THEN 'transactions' ELSE 'company_transactions' END;
    IF (v_table = 'transactions' AND NOT EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.id = v_id AND t.source_service_type = 'agent_cash_out' AND t.agent_id IS NOT NULL
    )) OR (v_table = 'company_transactions' AND NOT EXISTS (
      SELECT 1 FROM public.company_transactions t WHERE t.id = v_id AND t.company_id IS NOT NULL
    )) THEN RAISE EXCEPTION 'القيد الأصلي لحركة التاجر غير موجود'; END IF;
  END IF;

  IF v_table = 'transactions' AND v_type NOT IN ('agent_cash_out','merchant_cash_out_to_agent') THEN RETURN; END IF;
  IF v_table = 'transactions' AND v_type IS NULL THEN RETURN; END IF;
  v_kind := CASE v_table WHEN 'transactions' THEN 'merchant_cash_out_to_agent' ELSE 'merchant_cash_out_to_company' END;
  IF v_table = 'transactions' OR EXISTS (
    SELECT 1 FROM public.transactions t WHERE t.source_service_type = v_kind AND t.source_service_id = v_id::text
  ) THEN
    RETURN QUERY SELECT 'payout', v_table, v_id, v_table, v_id
      UNION ALL SELECT 'payout', v_table, v_id, 'transactions', t.id
      FROM public.transactions t WHERE t.source_service_type = v_kind AND t.source_service_id = v_id::text AND t.merchant_id IS NOT NULL;
  ELSIF v_table = 'company_transactions' AND v_merchant IS NOT NULL
    AND COALESCE(v_type,'') NOT LIKE 'opening_%' AND (
      EXISTS (SELECT 1 FROM public.payment_splits s WHERE s.source_table=v_table AND s.source_id=v_id AND s.cash_box_id IS NULL)
      OR EXISTS (SELECT 1 FROM public.company_transactions t WHERE t.id=v_id
        AND (COALESCE(t.merchant_cash_amount,0)<>0 OR COALESCE(t.merchant_cash_physical_amount,0)<>0))
    ) THEN
    -- Historical company funding without an exact merchant reference.
    RETURN QUERY SELECT 'unlinked', v_table, v_id, v_table, v_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION financial_internal.resolve_operation(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- This private adapter authorizes the requested action before returning the
-- group to the invoker. It does not write any financial data.
CREATE OR REPLACE FUNCTION financial_internal.lock_operation(p_table text, p_id uuid, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_group jsonb;
  v_kind text;
  v_section text;
  v_root_table text;
  v_root_id text;
  v_other text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_action NOT IN ('edit','delete') THEN RAISE EXCEPTION 'إجراء مالي غير صالح'; END IF;
  SELECT jsonb_agg(to_jsonb(g) ORDER BY g.member_table, g.member_id)
    INTO v_group FROM financial_internal.resolve_operation(p_table,p_id) g;
  IF v_group IS NULL THEN RETURN NULL; END IF;
  v_kind := v_group->0->>'kind';
  v_root_table := v_group->0->>'root_table';
  v_root_id := v_group->0->>'root_id';
  v_section := CASE
    WHEN v_kind = 'transfer' THEN 'reports'
    WHEN p_table = 'transactions' AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id=p_id AND t.agent_id IS NULL AND t.merchant_id IS NOT NULL) THEN 'merchants'
    WHEN p_table = 'transactions' THEN 'accounts'
    WHEN p_table = 'company_transactions' THEN 'companies'
    WHEN p_table = 'currency_supplier_transactions' THEN 'currency_suppliers'
    WHEN p_table = 'merchant_cash_collections' THEN 'merchants'
    WHEN p_table = 'usd_treasury_transactions' THEN 'reports'
    WHEN p_table = 'expense_deductions' THEN 'expenses'
    WHEN p_table = 'investor_transactions' THEN 'investors'
  END;
  IF v_kind = 'source_only' THEN RAISE EXCEPTION 'نفّذ التعديل أو الإلغاء من السجل الأصلي لتحديث جميع القيود'; END IF;
  IF v_section IS NULL OR NOT COALESCE(public.app_financial_action_allowed(v_section,p_action),false) THEN
    RAISE EXCEPTION 'لا تملك صلاحية هذا الإجراء المالي' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'unlinked' THEN RAISE EXCEPTION 'الحركة القديمة بدون رابط موثق لقيد التاجر؛ راجع القيود قبل تغييرها'; END IF;

  IF v_kind = 'direct' THEN
    SELECT m->>'member_id' INTO v_other FROM jsonb_array_elements(v_group) m WHERE m->>'member_table'='transactions';
    PERFORM pg_advisory_xact_lock(hashtextextended(least(v_root_id,v_other)||'|'||greatest(v_root_id,v_other),0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(v_root_table||':'||v_root_id,0));
  END IF;

  IF v_group IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(g) ORDER BY g.member_table,g.member_id)
      FROM financial_internal.resolve_operation(p_table,p_id) g) THEN
    RAISE EXCEPTION 'تغيّرت قيود الحركة؛ حدّث البيانات ثم أعد المحاولة';
  END IF;
  RETURN v_group;
END;
$$;
REVOKE ALL ON FUNCTION financial_internal.lock_operation(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION financial_internal.lock_operation(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_financial_cancel_state_atomic(
  p_table text, p_id uuid, p_cancel boolean, p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_group jsonb;
  v_kind text;
  v_entry jsonb;
  v_before jsonb;
  v_after jsonb;
  v_original jsonb;
  v_result jsonb := '[]';
  v_changed integer;
  v_actor uuid := auth.uid();
  v_when timestamptz := CASE WHEN p_cancel THEN clock_timestamp() END;
  v_reason text := NULLIF(btrim(p_reason),'');
  v_ids uuid[];
  v_section text;
  v_root_id uuid;
  v_root_table text;
BEGIN
  IF v_actor IS NULL OR p_id IS NULL OR p_cancel IS NULL OR (p_cancel AND v_reason IS NULL) THEN
    RAISE EXCEPTION 'بيانات الإلغاء أو إعادة التفعيل غير مكتملة';
  END IF;
  v_group := financial_internal.lock_operation(p_table,p_id,'delete');
  IF v_group IS NULL THEN
    v_section:=CASE
      WHEN p_table='transactions' AND EXISTS (SELECT 1 FROM public.transactions t
        WHERE t.id=p_id AND t.agent_id IS NULL AND t.merchant_id IS NOT NULL) THEN 'merchants'
      WHEN p_table='transactions' THEN 'accounts'
      WHEN p_table='company_transactions' THEN 'companies'
      WHEN p_table='expense_deductions' THEN 'expenses'
      WHEN p_table='usd_treasury_transactions' THEN 'reports'
      WHEN p_table='merchant_cash_collections' THEN 'merchants'
      WHEN p_table='payment_splits' AND EXISTS (SELECT 1 FROM public.payment_splits s
        WHERE s.id=p_id AND s.source_table='cash_transfers') THEN 'reports'
    END;
    IF v_section IS NULL OR NOT COALESCE(public.app_financial_action_allowed(v_section,'delete'),false) THEN
      RAISE EXCEPTION 'لا تملك صلاحية إلغاء هذه الحركة' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_table||':'||p_id::text,0));
    v_group:=jsonb_build_array(jsonb_build_object('kind','single','member_table',p_table,'member_id',p_id));
  END IF;
  v_kind := v_group->0->>'kind';
  v_root_id := (v_group->0->>'root_id')::uuid;
  v_root_table := v_group->0->>'root_table';
  IF v_kind = 'direct' THEN
    RETURN public.set_agent_company_direct_cancel_state_atomic(p_table,p_id,p_cancel,p_reason);
  END IF;
  IF v_kind = 'transfer' AND (jsonb_array_length(v_group) <> 2 OR NOT EXISTS (
    SELECT 1 FROM public.payment_splits a JOIN public.payment_splits b ON a.source_id=b.source_id
      AND a.source_table=b.source_table AND a.cash_box_id<>b.cash_box_id
      AND a.direction='out' AND b.direction='in' AND a.amount=b.amount AND a.currency=b.currency
    WHERE a.source_table='cash_box_transfer' AND a.source_id=(v_group->0->>'root_id')::uuid
  )) THEN RAISE EXCEPTION 'طرفا تحويل الخزينة غير متطابقين'; END IF;

  IF v_kind='payout' AND jsonb_array_length(v_group)-1 <> (
    SELECT count(*) FROM public.payment_splits s
    WHERE s.cash_box_id IS NULL AND ((s.source_table=v_root_table AND s.source_id=v_root_id)
      OR (v_root_table='transactions' AND s.transaction_id=v_root_id AND s.source_id IS NULL
        AND (s.source_table IS NULL OR s.source_table='transactions')))
  ) THEN
    RAISE EXCEPTION 'سطور التاجر غير مكتملة؛ يلزم مراجعة رابط الحركة قبل تغيير حالتها';
  END IF;

  IF v_kind='supplier' AND EXISTS (
    SELECT x->>'merchant_id',upper(COALESCE(x->>'currency','EGP')),abs((x->>'amount')::numeric)
    FROM public.currency_supplier_transactions t
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.payment_splits)='array'
      THEN t.payment_splits ELSE '[]' END) x
    WHERE t.id=v_root_id AND x->>'source'='merchant' AND (x->>'amount')::numeric>0
    EXCEPT ALL
    SELECT c.merchant_id::text,upper(COALESCE(c.opening_currency,'EGP')),abs(c.amount)
    FROM public.merchant_cash_collections c
    WHERE c.expense_id IS NULL AND c.source_service_type='currency_supplier' AND c.source_service_id=v_root_id
  ) THEN RAISE EXCEPTION 'قيود التاجر المرتبطة بحركة العملة غير مكتملة'; END IF;

  -- Lock and verify every linked ledger row before changing any cash-box split.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_group) LOOP
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',v_entry->>'member_table')
      INTO v_before USING (v_entry->>'member_id')::uuid;
    IF v_before IS NULL THEN RAISE EXCEPTION 'أحد قيود الحركة غير متاح'; END IF;
    IF v_entry->>'member_table'=p_table AND v_entry->>'member_id'=p_id::text THEN v_original := v_before; END IF;
    IF (v_before->>'cancelled_at' IS NOT NULL) IS DISTINCT FROM p_cancel THEN
      EXECUTE format('UPDATE public.%I t SET cancelled_at=$2,cancelled_by=$3,cancel_reason=$4 WHERE id=$1 RETURNING to_jsonb(t)',v_entry->>'member_table')
        INTO v_after USING (v_entry->>'member_id')::uuid,v_when,CASE WHEN p_cancel THEN v_actor END,CASE WHEN p_cancel THEN v_reason END;
      GET DIAGNOSTICS v_changed=ROW_COUNT;
      IF v_changed<>1 THEN RAISE EXCEPTION 'تعذر تحديث أحد طرفي الحركة أو صلاحياته'; END IF;
      v_result:=v_result||jsonb_build_array(v_entry||jsonb_build_object('before',v_before,'after',v_after));
    END IF;
  END LOOP;

  IF v_kind <> 'transfer' THEN
    SELECT ARRAY(
      SELECT s.id FROM public.payment_splits s
      WHERE (s.cancelled_at IS NOT NULL) IS DISTINCT FROM p_cancel
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_group) m
          WHERE (s.source_table=m->>'member_table' AND s.source_id=(m->>'member_id')::uuid)
             OR (m->>'member_table'='transactions' AND s.transaction_id=(m->>'member_id')::uuid
                 AND s.source_id IS NULL AND (s.source_table IS NULL OR s.source_table='transactions')))
      ORDER BY s.id FOR UPDATE
    ) INTO v_ids;
    UPDATE public.payment_splits SET cancelled_at=v_when,
      cancelled_by=CASE WHEN p_cancel THEN v_actor END,cancel_reason=CASE WHEN p_cancel THEN v_reason END
    WHERE id=ANY(v_ids);
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>cardinality(v_ids) THEN RAISE EXCEPTION 'تعذر تسوية سطور الدفع أو صلاحياتها'; END IF;
  END IF;

  RETURN jsonb_build_object('ok',true,'reused',v_result='[]'::jsonb AND COALESCE(cardinality(v_ids),0)=0,
    'before',v_original,'after',COALESCE((SELECT x->'after' FROM jsonb_array_elements(v_result) x
      WHERE x->>'member_table'=p_table AND x->>'member_id'=p_id::text),v_original),'linked_changes',v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.set_financial_cancel_state_atomic(text,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_financial_cancel_state_atomic(text,uuid,boolean,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.update_financial_transaction_atomic(
  p_table text, p_id uuid, p_parent_patch jsonb DEFAULT '{}', p_split_patches jsonb DEFAULT '[]'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_group jsonb;
  v_kind text;
  v_root_table text;
  v_root_id uuid;
  v_entry jsonb;
  v_before jsonb;
  v_after jsonb;
  v_original jsonb;
  v_patch jsonb := COALESCE(p_parent_patch,'{}') - ARRAY['_amount','_reason','_expected'];
  v_meta jsonb;
  v_result jsonb := '[]';
  v_id uuid;
  v_set text;
  v_total numeric;
  v_amount numeric;
  v_ratio numeric := 1;
  v_sign integer;
  v_count integer;
  v_plan jsonb := '{}';
  v_split public.payment_splits%ROWTYPE;
  v_planned numeric;
  v_prior numeric := 0;
  v_cash numeric := 0;
  v_insta numeric := 0;
  v_wallet numeric := 0;
  v_physical numeric := 0;
  v_mapped integer;
  v_scale integer;
  v_rate numeric;
BEGIN
  IF auth.uid() IS NULL OR p_id IS NULL OR jsonb_typeof(COALESCE(p_parent_patch,'{}')) <> 'object'
    OR jsonb_typeof(COALESCE(p_split_patches,'[]')) <> 'array' THEN
    RAISE EXCEPTION 'بيانات التعديل المالي غير صالحة';
  END IF;
  v_group := financial_internal.lock_operation(p_table,p_id,'edit');
  IF v_group IS NULL OR (v_group->0->>'kind'='supplier' AND p_table='currency_supplier_transactions') THEN
    RETURN financial_internal.update_financial_transaction_atomic(p_table,p_id,
      CASE WHEN p_table='payment_splits' THEN p_parent_patch-'_expected' ELSE p_parent_patch END,p_split_patches);
  END IF;
  v_kind := v_group->0->>'kind';
  v_root_table := v_group->0->>'root_table';
  v_root_id := (v_group->0->>'root_id')::uuid;
  IF v_kind='supplier' OR (v_kind='payout' AND (v_root_table<>p_table OR v_root_id<>p_id)) THEN
    RAISE EXCEPTION 'عدّل حركة الصرف أو العملة من سجل الطرف الأصلي لتسوية كل القيود';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_group) LOOP
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',v_entry->>'member_table')
      INTO v_before USING (v_entry->>'member_id')::uuid;
    IF v_before IS NULL OR v_before->>'cancelled_at' IS NOT NULL THEN
      RAISE EXCEPTION 'أحد طرفي الحركة ملغى أو غير متاح';
    END IF;
    IF v_entry->>'member_table'=p_table AND v_entry->>'member_id'=p_id::text THEN
      v_original := v_before;
    END IF;
  END LOOP;
  IF v_kind<>'transfer' AND v_kind<>'conversion' AND p_parent_patch ? '_amount'
    AND COALESCE(p_split_patches,'[]') <> '[]'::jsonb THEN
    RAISE EXCEPTION 'توزيع الدفع للحركة المرتبطة يُحسب داخل المعاملة';
  END IF;
  IF p_parent_patch ? '_expected' AND NOT COALESCE((p_parent_patch->'_expected') <@ v_original,false) THEN
    RAISE EXCEPTION 'تم تغيير الحركة؛ حدّث البيانات ثم أعد المحاولة';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_patch) k
    WHERE k NOT IN ('date','statement','note','total_paid','paid','usd_amount','egp_amount',
      'instapay_amount','cash_amount','mobile_cash_amount','mobile_cash_net_amount',
      'arabic_tourism_cash_amount','arabic_tourism_cash_net_amount','merchant_cash_amount',
      'merchant_cash_net_amount','merchant_cash_physical_amount')) THEN
    RAISE EXCEPTION 'حقول تعديل غير مسموح بها للحركة المرتبطة';
  END IF;
  SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO v_meta
    FROM jsonb_each(v_patch) WHERE key IN ('date','statement','note');

  IF v_kind='transfer' THEN
    IF jsonb_array_length(v_group)<>2 OR NOT EXISTS (
      SELECT 1 FROM public.payment_splits a JOIN public.payment_splits b
      ON a.source_table=b.source_table AND a.source_id=b.source_id AND a.direction='out' AND b.direction='in'
        AND a.cash_box_id<>b.cash_box_id AND a.amount=b.amount AND a.currency=b.currency
      WHERE a.source_table='cash_box_transfer' AND a.source_id=v_root_id
    ) THEN RAISE EXCEPTION 'طرفا تحويل الخزينة غير متطابقين'; END IF;
    IF jsonb_array_length(COALESCE(p_split_patches,'[]'))<>1 OR p_split_patches->0->>'id' IS DISTINCT FROM p_id::text THEN
      RAISE EXCEPTION 'يلزم مبلغ واحد لتحويل الخزينة';
    END IF;
    v_total := (v_original->>'amount')::numeric;
    v_amount := (p_split_patches->0->>'amount')::numeric;
  ELSIF v_kind='investor' THEN
    v_total := (v_original->>'amount')::numeric;
    v_amount := COALESCE((p_parent_patch->>'_amount')::numeric,v_total);
  ELSIF v_kind='conversion' THEN
    v_total := (v_original->>'usd_amount')::numeric;
    v_amount := COALESCE((v_patch->>'usd_amount')::numeric,v_total);
    v_rate := (v_original->>'exchange_rate')::numeric;
    IF v_amount IS DISTINCT FROM v_total AND COALESCE(v_rate,0)<=0 THEN
      RAISE EXCEPTION 'سعر الصرف الأصلي غير صالح';
    END IF;
    IF v_patch ? 'egp_amount' THEN RAISE EXCEPTION 'عدّل مبلغ الدولار لتحديث الطرفين بسعر الصرف الأصلي'; END IF;
  ELSE
    v_total := CASE WHEN v_kind='fine' AND p_table='transactions' THEN (v_original->>'price')::numeric
      ELSE COALESCE(NULLIF((v_original->>'total_paid')::numeric,0),(v_original->>'paid')::numeric) END;
    v_amount := COALESCE((p_parent_patch->>'_amount')::numeric,(v_patch->>'total_paid')::numeric,
      (v_patch->>'paid')::numeric,abs(v_total));
  END IF;
  IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<=0
    OR COALESCE(abs(v_total),0)<=0 THEN
    RAISE EXCEPTION 'المبلغ المرتبط يجب أن يكون رقماً صالحاً أكبر من صفر';
  END IF;
  v_ratio := v_amount/abs(v_total);
  v_scale := greatest(2,scale(trim_scale(v_amount)));

  IF v_kind IN ('direct','fine') AND EXISTS (
    SELECT 1 FROM public.company_transactions c JOIN public.transactions a ON a.id=(
      SELECT (x->>'member_id')::uuid FROM jsonb_array_elements(v_group) x WHERE x->>'member_table'='transactions'
    )
    WHERE c.id=v_root_id AND (c.total_paid IS DISTINCT FROM CASE WHEN v_kind='fine' THEN a.price ELSE a.total_paid END
      OR (v_kind='direct' AND a.currency IS DISTINCT FROM c.currency))
  ) THEN RAISE EXCEPTION 'قيم طرفي الحركة غير متطابقة؛ يلزم مراجعة القيد'; END IF;

  IF v_kind='payout' THEN
    -- The source split is the canonical allocation. Pair merchant mirrors
    -- using the explicit operation link plus currency, method, amount and
    -- occurrence number, so repeated equal payments remain distinct.
    FOR v_split IN SELECT s.* FROM public.payment_splits s
      WHERE s.source_table=v_root_table AND s.source_id=v_root_id ORDER BY s.id FOR UPDATE LOOP
      IF v_split.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'الحركة تتضمن سطر دفع ملغى'; END IF;
      IF v_ratio<>1 THEN
        v_planned := round((v_prior+v_split.amount)*v_ratio,v_scale)-round(v_prior*v_ratio,v_scale);
        IF v_planned<=0 THEN RAISE EXCEPTION 'المبلغ لا يكفي لتوزيع سطور الدفع'; END IF;
      ELSE v_planned := v_split.amount;
      END IF;
      v_prior := v_prior+v_split.amount;
      v_plan := v_plan||jsonb_build_object(v_split.id::text,v_planned);
      IF v_split.cash_box_id IS NULL THEN
        IF v_split.method='فودافون كاش' THEN v_wallet:=v_wallet+v_planned;
        ELSIF v_split.method='نقدي' THEN v_physical:=v_physical+v_planned;
        ELSIF v_split.method IN ('انستا','إنستاباي') THEN v_insta:=v_insta+v_planned;
        END IF;
      ELSIF v_split.method='نقدي' THEN v_cash:=v_cash+v_planned;
      ELSIF v_split.method IN ('انستا','إنستاباي') THEN v_insta:=v_insta+v_planned;
      END IF;
    END LOOP;
    IF v_prior<>abs(v_total) THEN RAISE EXCEPTION 'مبلغ الحركة لا يطابق سطور الدفع المحفوظة'; END IF;

    WITH root_splits AS (
      SELECT s.*, row_number() OVER (PARTITION BY s.currency,s.method,s.amount ORDER BY s.id) AS occurrence
      FROM public.payment_splits s
      WHERE s.source_table=v_root_table AND s.source_id=v_root_id AND s.cash_box_id IS NULL
    ), mirrors AS (
      SELECT t.id,t.currency,t.payment_method,abs(t.paid) AS amount,
        row_number() OVER (PARTITION BY t.currency,t.payment_method,abs(t.paid) ORDER BY t.id) AS occurrence
      FROM public.transactions t
      JOIN jsonb_array_elements(v_group) g ON g->>'member_table'='transactions'
        AND g->>'member_id'=t.id::text AND t.id<>v_root_id
    )
    SELECT count(*), COALESCE(jsonb_object_agg(m.id::text,v_plan->s.id::text),'{}')
      INTO v_mapped,v_patch
    FROM mirrors m JOIN root_splits s
      ON (m.currency,m.payment_method,m.amount,m.occurrence)=(s.currency,s.method,s.amount,s.occurrence);
    IF v_mapped<>jsonb_array_length(v_group)-1 OR v_mapped<>(
      SELECT count(*) FROM public.payment_splits s WHERE s.source_table=v_root_table AND s.source_id=v_root_id AND s.cash_box_id IS NULL
    ) THEN RAISE EXCEPTION 'سطور صرف التاجر لا تطابق القيد الأصلي؛ يلزم مراجعة الربط'; END IF;
    v_plan:=v_plan||v_patch;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_group) LOOP
    v_id:=(v_entry->>'member_id')::uuid;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',v_entry->>'member_table')
      INTO v_before USING v_id;
    v_patch := v_meta;
    IF v_kind='transfer' THEN
      v_patch:='{}';
    ELSIF v_ratio<>1 THEN
      v_sign:=CASE WHEN COALESCE(NULLIF((v_before->>'total_paid')::numeric,0),(v_before->>'paid')::numeric,1)<0 THEN -1 ELSE 1 END;
      IF v_kind='investor' THEN
        v_patch:=v_patch||jsonb_build_object('amount',v_amount);
      ELSIF v_kind='conversion' THEN
        v_patch:=v_patch||jsonb_build_object('usd_amount',v_amount,'egp_amount',round(v_amount*v_rate,2));
      ELSIF v_kind='fine' AND v_entry->>'member_table'='transactions' THEN
        v_patch:=v_patch||jsonb_build_object('price',v_amount);
      ELSIF v_kind='payout' AND v_id<>v_root_id THEN
        v_patch:=v_patch||jsonb_build_object('paid',-(v_plan->>v_id::text)::numeric,'total_paid',-(v_plan->>v_id::text)::numeric);
      ELSE
        v_patch:=v_patch||jsonb_build_object('total_paid',v_sign*v_amount);
        IF v_entry->>'member_table'='transactions' THEN
          v_patch:=v_patch||jsonb_build_object('paid',v_sign*v_amount);
        END IF;
        IF v_kind='payout' AND v_entry->>'member_table'='company_transactions' THEN
          v_patch:=v_patch||jsonb_build_object('cash_amount',v_sign*v_cash,'instapay_amount',v_sign*v_insta,
            'merchant_cash_amount',v_sign*v_wallet,'merchant_cash_net_amount',v_sign*v_wallet,
            'merchant_cash_physical_amount',v_sign*v_physical);
        ELSIF v_kind IN ('direct','fine') THEN
          v_patch:=v_patch||COALESCE((SELECT jsonb_object_agg(k,to_jsonb(round((v_before->>k)::numeric*v_ratio,v_scale)))
            FROM unnest(ARRAY['instapay_amount','cash_amount','mobile_cash_amount','mobile_cash_net_amount',
              'arabic_tourism_cash_amount','arabic_tourism_cash_net_amount']) k WHERE v_before->>k IS NOT NULL),'{}');
        END IF;
      END IF;
    END IF;
    IF v_patch <> '{}'::jsonb THEN
      SELECT string_agg(format('%1$I=x.%1$I',k),', ' ORDER BY k) INTO v_set FROM jsonb_object_keys(v_patch) k;
      EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) x WHERE t.id=$2 RETURNING to_jsonb(t)',
        v_entry->>'member_table',v_set) INTO v_after USING v_patch,v_id;
      GET DIAGNOSTICS v_count=ROW_COUNT;
      IF v_count<>1 THEN RAISE EXCEPTION 'تعذر تعديل أحد طرفي الحركة أو صلاحياته'; END IF;
      v_result:=v_result||jsonb_build_array(v_entry||jsonb_build_object('before',v_before,'after',v_after));
    END IF;

    IF v_ratio<>1 AND v_kind IN ('payout','transfer','investor') THEN
      v_count:=0;
      FOR v_split IN SELECT s.* FROM public.payment_splits s
        WHERE (v_kind='transfer' AND s.id=v_id)
           OR (v_kind IN ('payout','investor') AND s.source_table=v_entry->>'member_table' AND s.source_id=v_id)
        ORDER BY s.id FOR UPDATE LOOP
        v_planned:=CASE WHEN v_kind IN ('transfer','investor') THEN v_amount
          WHEN v_id=v_root_id THEN (v_plan->>v_split.id::text)::numeric
          ELSE (v_plan->>v_id::text)::numeric END;
        IF v_split.cancelled_at IS NOT NULL OR v_planned IS NULL OR v_split.amount<=0
          OR (v_kind='investor' AND (v_split.cash_box_id IS NULL OR v_split.amount<>v_total))
          OR (v_kind='payout' AND v_id<>v_root_id AND (
            v_split.cash_box_id IS NOT NULL OR v_split.amount<>abs((v_before->>'paid')::numeric)
            OR v_split.currency IS DISTINCT FROM v_before->>'currency'
            OR v_split.method IS DISTINCT FROM v_before->>'payment_method'
          )) THEN RAISE EXCEPTION 'بيانات سطر الدفع المرتبط غير متطابقة'; END IF;
        UPDATE public.payment_splits SET amount=v_planned,
          gross_amount=round(v_split.gross_amount*v_planned/v_split.amount,v_scale),
          net_amount=round(v_split.net_amount*v_planned/v_split.amount,v_scale),
          merchant_commission_amount=round(v_split.merchant_commission_amount*v_planned/v_split.amount,v_scale),
          egp_equivalent=round(v_split.egp_equivalent*v_planned/v_split.amount,v_scale)
        WHERE id=v_split.id RETURNING to_jsonb(payment_splits.*) INTO v_after;
        IF NOT FOUND THEN RAISE EXCEPTION 'تعذر تحديث سطر الدفع أو صلاحياته'; END IF;
        IF v_kind='transfer' THEN
          v_result:=v_result||jsonb_build_array(v_entry||jsonb_build_object('before',to_jsonb(v_split),'after',v_after));
        END IF;
        v_count:=v_count+1;
      END LOOP;
      IF (v_kind IN ('transfer','investor') OR v_id<>v_root_id) AND v_count<>1 THEN
        RAISE EXCEPTION 'سطر الدفع المقابل غير موجود أو مكرر';
      END IF;
    END IF;
  END LOOP;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',p_table) INTO v_after USING p_id;
  RETURN jsonb_build_object('ok',true,'before',v_original,'after',v_after,'linked_changes',v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.update_financial_transaction_atomic(text,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_financial_transaction_atomic(text,uuid,jsonb,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.execute_financial_atomic(
  p_operation_id uuid, p_fingerprint text, p_rows jsonb, p_result jsonb DEFAULT '{}'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_entry jsonb;
  v_row jsonb;
  v_id text;
  v_table text;
  v_type text;
  v_mirror_type text;
  v_splits jsonb;
  v_mirrors jsonb;
  v_split jsonb;
  v_other_table text;
  v_counterpart_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ حركة مالية'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR EXISTS (
    SELECT 1 FROM public.financial_operation_requests r WHERE r.operation_id=p_operation_id
  ) THEN
    RETURN financial_internal.execute_financial_atomic(p_operation_id,p_fingerprint,p_rows,p_result);
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_table:=v_entry->>'table';
    v_row:=v_entry->'row';
    v_id:=v_row->>'id';
    v_type:=v_row->>'source_service_type';

    IF v_table='payment_splits' AND v_row->>'source_table'='cash_box_transfer' THEN
      SELECT jsonb_agg(x->'row') INTO v_splits FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'='payment_splits' AND x->'row'->>'source_table'='cash_box_transfer'
          AND x->'row'->>'source_id'=v_row->>'source_id';
      IF v_row->>'source_id' IS NULL OR jsonb_array_length(v_splits)<>2 OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_splits) a CROSS JOIN jsonb_array_elements(v_splits) b
        WHERE a->>'direction'='out' AND b->>'direction'='in'
          AND a->>'cash_box_id'<>b->>'cash_box_id' AND a->>'currency'=b->>'currency'
          AND (a->>'amount')::numeric=(b->>'amount')::numeric
      ) THEN RAISE EXCEPTION 'يلزم تسجيل طرفي تحويل الخزائن معاً'; END IF;
    ELSIF v_table IN ('transactions','company_transactions') AND v_type='agent_direct_to_company' THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'=CASE v_table WHEN 'transactions' THEN 'company_transactions' ELSE 'transactions' END
          AND x->'row'->>'source_service_type'=v_type
          AND x->'row'->>'id'=v_row->>'source_service_id' AND x->'row'->>'source_service_id'=v_id
          AND x->'row'->>'currency'=v_row->>'currency'
          AND (x->'row'->>'total_paid')::numeric=(v_row->>'total_paid')::numeric
      ) THEN RAISE EXCEPTION 'يلزم تسجيل طرفي تحويل الوكيل والشركة معاً'; END IF;
    ELSIF v_table IN ('transactions','company_transactions') AND v_type IN ('submission_fine','execution_fine') THEN
      v_other_table:=CASE v_table WHEN 'transactions' THEN 'company_transactions' ELSE 'transactions' END;
      v_split:=CASE WHEN v_table='transactions' THEN v_row->'price' ELSE v_row->'total_paid' END;
      IF NULLIF(v_row->>'source_service_id','') IS NULL THEN RAISE EXCEPTION 'الغرامة بدون رابط محفوظ'; END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'=v_other_table AND x->'row'->>'source_service_type'=v_type
          AND x->'row'->>'source_service_id'=v_row->>'source_service_id'
          AND x->'row'->(CASE v_other_table WHEN 'transactions' THEN 'price' ELSE 'total_paid' END)=v_split
      ) THEN
        -- Older one-sided fines can be completed against the exact active link.
        EXECUTE format('SELECT count(*)=1 FROM public.%I t WHERE source_service_type=$1 AND source_service_id=$2 AND cancelled_at IS NULL AND %I=$3',
          v_other_table,CASE v_other_table WHEN 'transactions' THEN 'price' ELSE 'total_paid' END)
          INTO v_counterpart_ok USING v_type,v_row->>'source_service_id',(v_split #>> '{}')::numeric;
        IF NOT v_counterpart_ok THEN RAISE EXCEPTION 'يلزم تسجيل طرفي الغرامة معاً'; END IF;
      END IF;
    ELSIF v_table='transactions' AND v_type IN ('merchant_cash_out_to_agent','merchant_cash_out_to_company') THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'=CASE v_type WHEN 'merchant_cash_out_to_agent' THEN 'transactions' ELSE 'company_transactions' END
          AND x->'row'->>'id'=v_row->>'source_service_id'
          AND (v_type<>'merchant_cash_out_to_agent' OR x->'row'->>'source_service_type'='agent_cash_out'))
        OR (SELECT count(*) FROM jsonb_array_elements(p_rows) x
          WHERE x->>'table'='payment_splits' AND x->'row'->>'source_table'='transactions'
            AND x->'row'->>'source_id'=v_id AND x->'row'->>'cash_box_id' IS NULL
            AND x->'row'->>'method'=v_row->>'payment_method' AND x->'row'->>'currency'=v_row->>'currency'
            AND x->'row'->>'direction'='out' AND (x->'row'->>'amount')::numeric=abs((v_row->>'paid')::numeric))<>1
        OR v_row->>'merchant_id' IS NULL THEN RAISE EXCEPTION 'قيد التاجر أو سطر دفعه المقابل غير مكتمل'; END IF;
    ELSIF (v_table='transactions' AND v_type='agent_cash_out')
       OR (v_table='company_transactions' AND v_row->>'merchant_id' IS NOT NULL
         AND COALESCE(v_type,'') NOT LIKE 'opening_%') THEN
      v_mirror_type:=CASE v_table WHEN 'transactions' THEN 'merchant_cash_out_to_agent' ELSE 'merchant_cash_out_to_company' END;
      SELECT COALESCE(jsonb_agg(x->'row'),'[]') INTO v_splits FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'='payment_splits' AND x->'row'->>'source_table'=v_table
          AND x->'row'->>'source_id'=v_id AND x->'row'->>'cash_box_id' IS NULL;
      SELECT COALESCE(jsonb_agg(x->'row'),'[]') INTO v_mirrors FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'='transactions' AND x->'row'->>'source_service_type'=v_mirror_type
          AND x->'row'->>'source_service_id'=v_id;
      IF COALESCE((SELECT sum((x->'row'->>'amount')::numeric) FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'='payment_splits' AND x->'row'->>'source_table'=v_table AND x->'row'->>'source_id'=v_id),0)
          IS DISTINCT FROM abs(COALESCE((v_row->>'total_paid')::numeric,(v_row->>'paid')::numeric))
        THEN RAISE EXCEPTION 'مبلغ الحركة لا يطابق سطور الدفع عند الحفظ'; END IF;
      IF (SELECT array_agg(ARRAY[s->>'currency',s->>'method',trim_scale((s->>'amount')::numeric)::text] ORDER BY
          s->>'currency',s->>'method',trim_scale((s->>'amount')::numeric)) FROM jsonb_array_elements(v_splits) s)
        IS DISTINCT FROM
        (SELECT array_agg(ARRAY[m->>'currency',m->>'payment_method',trim_scale(abs((m->>'paid')::numeric))::text] ORDER BY
          m->>'currency',m->>'payment_method',trim_scale(abs((m->>'paid')::numeric))) FROM jsonb_array_elements(v_mirrors) m)
        THEN RAISE EXCEPTION 'تم رفض حفظ الصرف لأن سطور التاجر لا تطابق سطور القيد الأصلي'; END IF;
    ELSIF v_table='investor_transactions' THEN
      IF (SELECT count(*) FROM jsonb_array_elements(p_rows) x
        WHERE x->>'table'='payment_splits' AND x->'row'->>'source_table'=v_table AND x->'row'->>'source_id'=v_id
          AND x->'row'->>'cash_box_id' IS NOT NULL AND (x->'row'->>'amount')::numeric=(v_row->>'amount')::numeric
          AND x->'row'->>'direction'=CASE v_row->>'transaction_type'
            WHEN 'توريد نقدية' THEN 'in' WHEN 'صرف نقدية' THEN 'out' END)<>1
        THEN RAISE EXCEPTION 'يلزم تسجيل طرف الخزينة في حركة المالك أو المستثمر'; END IF;
    ELSIF v_table='currency_supplier_transactions' AND jsonb_typeof(v_row->'payment_splits')='array' THEN
      IF EXISTS (
        (SELECT s->>'merchant_id', upper(COALESCE(s->>'currency','EGP')), abs((s->>'amount')::numeric)
         FROM jsonb_array_elements(v_row->'payment_splits') s WHERE s->>'source'='merchant' AND (s->>'amount')::numeric>0
         EXCEPT ALL
         SELECT x->'row'->>'merchant_id', upper(COALESCE(x->'row'->>'opening_currency','EGP')), abs((x->'row'->>'amount')::numeric)
         FROM jsonb_array_elements(p_rows) x WHERE x->>'table'='merchant_cash_collections'
           AND x->'row'->>'source_service_type'='currency_supplier' AND x->'row'->>'source_service_id'=v_id)
      ) THEN RAISE EXCEPTION 'طرف التاجر في حركة العملة غير مكتمل'; END IF;
    END IF;
  END LOOP;

  RETURN financial_internal.execute_financial_atomic(p_operation_id,p_fingerprint,p_rows,p_result);
END;
$$;
REVOKE ALL ON FUNCTION public.execute_financial_atomic(uuid,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.execute_financial_atomic(uuid,text,jsonb,jsonb) TO authenticated,service_role;

-- Legacy expenses can own treasury splits through their deductions. The
-- expense remains the only delete entry point for the principal and its funding.
CREATE OR REPLACE FUNCTION public.delete_expense_atomic(p_expense_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_split_ids uuid[];
  v_collections uuid[];
  v_changed integer;
BEGIN
  IF auth.uid() IS NULL OR p_expense_id IS NULL THEN RAISE EXCEPTION 'بيانات حذف المصروف غير مكتملة'; END IF;
  IF NOT COALESCE(public.app_permission_allowed('expenses','delete'),false) THEN
    RAISE EXCEPTION 'لا تملك صلاحية حذف المصروف' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('expenses:'||p_expense_id::text,0));
  PERFORM 1 FROM public.expenses WHERE id=p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'reused',true); END IF;

  SELECT ARRAY(SELECT id FROM public.expense_deductions WHERE expense_id=p_expense_id ORDER BY id FOR UPDATE) INTO v_ids;
  SELECT ARRAY(SELECT id FROM public.merchant_cash_collections WHERE expense_id=p_expense_id ORDER BY id FOR UPDATE) INTO v_collections;
  SELECT ARRAY(SELECT id FROM public.payment_splits
    WHERE (source_table='expenses' AND source_id=p_expense_id)
      OR (source_table='expense_deductions' AND source_id=ANY(v_ids))
      OR (source_table='merchant_cash_collections' AND source_id=ANY(v_collections))
    ORDER BY id FOR UPDATE) INTO v_split_ids;
  DELETE FROM public.payment_splits WHERE id=ANY(v_split_ids);
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed<>cardinality(v_split_ids) THEN RAISE EXCEPTION 'تعذر حذف سطور دفع المصروف'; END IF;
  DELETE FROM public.expense_deductions WHERE id=ANY(v_ids);
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed<>cardinality(v_ids) THEN RAISE EXCEPTION 'تعذر حذف خصومات المصروف'; END IF;
  DELETE FROM public.merchant_cash_collections WHERE id=ANY(v_collections);
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  IF v_changed<>cardinality(v_collections) THEN RAISE EXCEPTION 'تعذر حذف طرف التاجر في المصروف'; END IF;
  DELETE FROM public.expenses WHERE id=p_expense_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'تعذر حذف المصروف'; END IF;
  RETURN jsonb_build_object('ok',true,'reused',false);
END;
$$;
