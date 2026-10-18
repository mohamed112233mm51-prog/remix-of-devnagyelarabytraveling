-- Extend the SAME execution posting RPC and signature. The request now carries
-- the execution mutation plus its existing canonical posting plan. No new ledger,
-- financial RPC, cash-balance writer, or alternate posting rules are introduced.
CREATE OR REPLACE FUNCTION public.replace_execution_financials_atomic(
  p_operation_id uuid, p_fingerprint text, p_execution_id uuid,
  p_financial_posting_date date, p_rows jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_action text := p_rows->>'action';
  v_patch jsonb := p_rows->'execution_patch';
  v_expected jsonb := p_rows->'expected';
  v_rows jsonb := p_rows->'rows';
  v_before jsonb;
  v_after jsonb;
  v_candidate jsonb;
  v_result jsonb;
  v_saved record;
  v_step jsonb;
  v_row jsonb;
  v_table text;
  v_cols text;
  v_select text;
  v_set text;
  v_date date;
  v_prefix text := p_execution_id::text || '::%';
  v_hash text := md5(jsonb_build_object('executionId',p_execution_id,'request',p_rows)::text);
  v_count integer := 0;
  v_expected_count integer;
  v_updated integer;
  v_service_index integer;
  v_service jsonb;
  v_submission public.submissions%ROWTYPE;
  v_rec record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ حركة مالية'; END IF;
  IF p_execution_id IS NULL OR p_operation_id IS NULL OR COALESCE(btrim(p_fingerprint),'')='' THEN
    RAISE EXCEPTION 'معرّف التنفيذ والعملية وبصمتها مطلوبة';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'object' OR v_action IS NULL OR v_action NOT IN ('create','update','delete')
    OR jsonb_typeof(v_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(v_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'يلزم تحديث الصفحة: حفظ التنفيذ وقيوده يجب أن يكون في طلب واحد';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_rows) k WHERE k NOT IN ('action','execution_patch','expected','rows')) THEN
    RAISE EXCEPTION 'حقول طلب التنفيذ غير صالحة';
  END IF;
  IF NOT public.app_permission_allowed('executions',CASE WHEN v_action='update' THEN 'edit' ELSE v_action END) THEN
    RAISE EXCEPTION 'ليست لديك صلاحية حفظ أو حذف التنفيذ';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_patch) k WHERE k NOT IN (
    'submission_id','passenger_name','national_id','dob','passport','birth_place','agent_id','status',
    'departure_from','destination','airline','travel_date','notes','services','operation_status',
    'approval_company_id','passenger_type','approval_validity_enabled','issue_date')) THEN
    RAISE EXCEPTION 'حقول تعديل التنفيذ غير مسموح بها';
  END IF;
  IF v_action='delete' AND (v_patch<>'{}'::jsonb OR v_rows<>'[]'::jsonb) THEN
    RAISE EXCEPTION 'طلب حذف التنفيذ لا يقبل بيانات أو قيودًا جديدة';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('execution:'||p_execution_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,1));
  SELECT * INTO v_saved FROM public.financial_operation_requests WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_saved.fingerprint IS DISTINCT FROM p_fingerprint OR v_saved.result->>'requestHash' IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'تم استخدام معرّف العملية سابقًا ببيانات مختلفة';
    END IF;
    RETURN jsonb_build_object('ok',true,'reused',true,'result',v_saved.result);
  END IF;

  IF v_action='delete' THEN
    -- Row-locking SELECT requires UPDATE RLS. Delete-only operators instead use
    -- the same advisory lock plus a snapshot predicate on the final DELETE.
    SELECT to_jsonb(e) INTO v_before FROM public.executions e WHERE id=p_execution_id;
  ELSE
    SELECT to_jsonb(e) INTO v_before FROM public.executions e WHERE id=p_execution_id FOR UPDATE;
  END IF;
  IF v_action='create' THEN
    IF v_before IS NOT NULL THEN RAISE EXCEPTION 'التنفيذ موجود بالفعل؛ حدّث البيانات قبل إعادة المحاولة'; END IF;
    IF v_expected IS NOT NULL AND v_expected<>'null'::jsonb THEN RAISE EXCEPTION 'طلب الإنشاء لا يقبل نسخة سابقة'; END IF;
    v_candidate:=v_patch;
  ELSE
    IF v_before IS NULL THEN RAISE EXCEPTION 'التنفيذ غير موجود أو غير مسموح بتعديله'; END IF;
    IF jsonb_typeof(v_expected) IS DISTINCT FROM 'object'
      OR v_expected->>'id' IS DISTINCT FROM p_execution_id::text
      OR NOT (v_expected ?& ARRAY['services','operation_status','agent_id']) THEN
      RAISE EXCEPTION 'بيانات التنفيذ الأصلية مطلوبة للتعديل أو الحذف';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(v_expected-ARRAY['updated_at','fx_locks','fx_locked_at']) k WHERE v_before->k.key IS DISTINCT FROM k.value) THEN
      RAISE EXCEPTION 'تم تعديل التنفيذ بواسطة مستخدم آخر؛ حدّث البيانات ثم أعد المحاولة';
    END IF;
    v_candidate:=v_before||v_patch;
    IF (v_before->>'submission_id') IS NOT NULL AND (v_candidate->>'submission_id') IS DISTINCT FROM (v_before->>'submission_id') THEN
      RAISE EXCEPTION 'لا يمكن نقل التنفيذ إلى تقديم آخر';
    END IF;
  END IF;

  IF v_action<>'delete' THEN
    IF COALESCE(btrim(v_candidate->>'passenger_name'),'')='' OR jsonb_typeof(v_candidate->'services') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'اسم المسافر وخدمات التنفيذ مطلوبة';
    END IF;
    -- Creation/travel date are operational. Set the first accounting date only
    -- when executed, using the DB calendar in Cairo, and never move it on edit.
    v_date:=(v_before->>'financial_posting_date')::date;
    IF v_candidate->>'operation_status'='منفذ' THEN
      v_date:=COALESCE(v_date,(now() AT TIME ZONE 'Africa/Cairo')::date);
    ELSIF v_rows<>'[]'::jsonb THEN
      RAISE EXCEPTION 'التنفيذ غير المعتمد لا يقبل قيودًا مالية';
    END IF;
    v_patch:=v_patch||jsonb_build_object('financial_posting_date',v_date);
    IF v_action='create' THEN
      v_patch:=v_patch||jsonb_build_object('id',p_execution_id);
      SELECT string_agg(format('%I',key),', ' ORDER BY key),string_agg(format('x.%I',key),', ' ORDER BY key)
        INTO v_cols,v_select FROM jsonb_object_keys(v_patch) key;
      EXECUTE format('INSERT INTO public.executions (%s) SELECT %s FROM jsonb_populate_record(NULL::public.executions,$1) x RETURNING to_jsonb(executions.*)',v_cols,v_select)
        INTO v_after USING v_patch;
    ELSE
      SELECT string_agg(format('%1$I=x.%1$I',key),', ' ORDER BY key) INTO v_set FROM jsonb_object_keys(v_patch) key;
      EXECUTE format('UPDATE public.executions e SET %s FROM jsonb_populate_record(NULL::public.executions,$1) x WHERE e.id=$2 RETURNING to_jsonb(e.*)',v_set)
        INTO v_after USING v_patch,p_execution_id;
    END IF;
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>1 OR v_after IS NULL THEN RAISE EXCEPTION 'تعذر حفظ التنفيذ أو صلاحياته'; END IF;

    IF (v_after->>'submission_id') IS NOT NULL AND
      (v_action='create' OR v_before->>'submission_id' IS DISTINCT FROM v_after->>'submission_id') THEN
      SELECT * INTO v_submission FROM public.submissions WHERE id=(v_after->>'submission_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'التقديم المرتبط غير موجود أو غير مسموح بتعديله'; END IF;
      IF v_submission.execution_id IS NOT NULL AND v_submission.execution_id<>p_execution_id THEN
        RAISE EXCEPTION 'تم تحويل هذا التقديم إلى تنفيذ آخر بالفعل';
      END IF;
      UPDATE public.submissions SET execution_id=p_execution_id,executed_at=now(),operation_status='تم التحويل للتنفيذ' WHERE id=v_submission.id;
      GET DIAGNOSTICS v_updated=ROW_COUNT;
      IF v_updated<>1 THEN RAISE EXCEPTION 'تعذر ربط التقديم بالتنفيذ'; END IF;
    END IF;
  ELSE
    v_date:=(v_before->>'financial_posting_date')::date;
  END IF;

  -- DELETE acquires ledger row locks. Verify that RLS really deletes ALL
  -- visible linked rows; silently deleting zero is not a success.
  FOR v_table IN SELECT unnest(ARRAY['transactions','company_transactions']) LOOP
    v_expected_count:=0;
    FOR v_rec IN EXECUTE format('SELECT to_jsonb(t) AS row FROM public.%I t WHERE source_service_type=''execution'' AND source_service_id LIKE $1 ORDER BY id',v_table) USING v_prefix LOOP
      IF EXISTS(SELECT 1 FROM public.payment_splits s WHERE s.source_table=v_table AND s.source_id=(v_rec.row->>'id')::uuid) THEN
        RAISE EXCEPTION 'قيود التنفيذ مرتبطة بسداد خزينة؛ راجع التسوية قبل الاستبدال أو الحذف';
      END IF;
      v_expected_count:=v_expected_count+1;
      INSERT INTO public.financial_audit_log(table_name,record_id,action,reason,performed_by,before_value,entity_type,entity_id)
        VALUES(v_table,(v_rec.row->>'id')::uuid,'delete','استبدال قيود التنفيذ',auth.uid(),v_rec.row,'execution',p_execution_id);
    END LOOP;
    EXECUTE format('DELETE FROM public.%I WHERE source_service_type=''execution'' AND source_service_id LIKE $1',v_table) USING v_prefix;
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>v_expected_count THEN RAISE EXCEPTION 'تعذر حذف كل قيود التنفيذ؛ تم التراجع عن العملية'; END IF;
  END LOOP;

  FOR v_step IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    v_table:=v_step->>'table'; v_row:=v_step->'row';
    IF v_table IS NULL OR v_table NOT IN ('transactions','company_transactions') OR jsonb_typeof(v_row) IS DISTINCT FROM 'object'
      OR NOT (v_row ? 'id') OR v_date IS NULL THEN RAISE EXCEPTION 'سطر التنفيذ المالي غير صالح'; END IF;
    IF v_row->>'source_service_type' IS DISTINCT FROM 'execution'
      OR COALESCE(v_row->>'source_service_id','') !~ ('^'||p_execution_id::text||'::[0-9]+$') THEN
      RAISE EXCEPTION 'القيد المالي لا يخص التنفيذ المطلوب';
    END IF;
    v_service_index:=split_part(v_row->>'source_service_id','::',2)::integer;
    v_service:=v_after->'services'->v_service_index;
    IF v_service IS NULL OR v_service='null'::jsonb OR v_row->>'service_type' IS DISTINCT FROM v_service->>'service_type'
      OR upper(COALESCE(v_row->>'currency','EGP')) IS DISTINCT FROM upper(COALESCE(NULLIF(btrim(v_service->>'currency'),''),'EGP')) THEN
      RAISE EXCEPTION 'القيد المالي لا يطابق خدمة التنفيذ المحفوظة';
    END IF;
    IF (v_table='transactions' AND (v_row->>'agent_id' IS DISTINCT FROM v_after->>'agent_id' OR v_service->>'kind'='company'))
      OR (v_table='company_transactions' AND (v_row->>'company_id' IS DISTINCT FROM v_service->>'company_id' OR v_service->>'kind'='agent')) THEN
      RAISE EXCEPTION 'طرف القيد المالي لا يطابق التنفيذ';
    END IF;
    -- The existing JS builder remains the only price/allocation rule generator.
    -- The DB binds its rows to the locked canonical execution and owns the date.
    v_row:=jsonb_set(v_row,'{date}',to_jsonb(v_date::text),true);
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_row) k WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=v_table AND c.column_name=k AND c.is_generated='NEVER' AND c.is_identity='NO')) THEN
      RAISE EXCEPTION 'أعمدة القيود المالية غير صالحة';
    END IF;
    SELECT string_agg(format('%I',key),', ' ORDER BY key),string_agg(format('x.%I',key),', ' ORDER BY key)
      INTO v_cols,v_select FROM jsonb_object_keys(v_row) key;
    EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I,$1) x',v_table,v_cols,v_select) USING v_row;
    INSERT INTO public.financial_audit_log(table_name,record_id,action,reason,performed_by,after_value,entity_type,entity_id,reference_no)
      VALUES(v_table,(v_row->>'id')::uuid,'create','توليد من التنفيذ',auth.uid(),v_row,'execution',p_execution_id,v_date::text);
    v_count:=v_count+1;
  END LOOP;

  IF v_action='delete' THEN
    FOR v_submission IN SELECT * FROM public.submissions WHERE execution_id=p_execution_id ORDER BY id FOR UPDATE LOOP
      UPDATE public.submissions SET execution_id=NULL,executed_at=NULL,
        operation_status=CASE WHEN operation_status='تم التحويل للتنفيذ' THEN 'قيد المتابعة' ELSE operation_status END WHERE id=v_submission.id;
      GET DIAGNOSTICS v_updated=ROW_COUNT;
      IF v_updated<>1 THEN RAISE EXCEPTION 'تعذر فك ربط التقديم بالتنفيذ'; END IF;
    END LOOP;
    DELETE FROM public.executions e WHERE id=p_execution_id
      AND NOT EXISTS(SELECT 1 FROM jsonb_each(v_expected-ARRAY['updated_at','fx_locks','fx_locked_at']) k WHERE to_jsonb(e)->k.key IS DISTINCT FROM k.value);
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>1 THEN RAISE EXCEPTION 'تعذر حذف التنفيذ؛ تم التراجع عن القيود'; END IF;
  END IF;
  INSERT INTO public.financial_audit_log(table_name,record_id,action,reason,performed_by,before_value,after_value,entity_type,entity_id,reference_no)
    VALUES('executions',p_execution_id,CASE WHEN v_action='update' THEN 'edit' ELSE v_action END,
      'حفظ التنفيذ وقيوده في معاملة واحدة',auth.uid(),v_before,v_after,'execution',p_execution_id,v_date::text);
  v_result:=jsonb_build_object('executionId',p_execution_id,'execution',v_after,'postingDate',v_date,'rows',v_count,'action',v_action,'requestHash',v_hash);
  INSERT INTO public.financial_operation_requests(operation_id,fingerprint,result,created_by) VALUES(p_operation_id,p_fingerprint,v_result,auth.uid());
  RETURN jsonb_build_object('ok',true,'reused',false,'result',v_result);
END; $$;
REVOKE ALL ON FUNCTION public.replace_execution_financials_atomic(uuid,text,uuid,date,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_execution_financials_atomic(uuid,text,uuid,date,jsonb) TO authenticated,service_role;

-- Extend the existing permission boundary only for linked execution debts.
-- Create-only operators can create a complete execution; delete-only operators
-- can remove its generated rows before the parent in the same transaction.
CREATE POLICY transactions_execution_create ON public.transactions FOR INSERT TO authenticated
WITH CHECK(source_service_type='execution' AND public.app_permission_allowed('executions','create')
  AND EXISTS(SELECT 1 FROM public.executions e WHERE e.id::text=split_part(transactions.source_service_id,'::',1)));
CREATE POLICY company_transactions_execution_create ON public.company_transactions FOR INSERT TO authenticated
WITH CHECK(source_service_type='execution' AND public.app_permission_allowed('executions','create')
  AND EXISTS(SELECT 1 FROM public.executions e WHERE e.id::text=split_part(company_transactions.source_service_id,'::',1)));
CREATE POLICY transactions_execution_delete ON public.transactions FOR DELETE TO authenticated
USING(source_service_type='execution' AND public.app_permission_allowed('executions','delete')
  AND EXISTS(SELECT 1 FROM public.executions e WHERE e.id::text=split_part(transactions.source_service_id,'::',1)));
CREATE POLICY company_transactions_execution_delete ON public.company_transactions FOR DELETE TO authenticated
USING(source_service_type='execution' AND public.app_permission_allowed('executions','delete')
  AND EXISTS(SELECT 1 FROM public.executions e WHERE e.id::text=split_part(company_transactions.source_service_id,'::',1)));

-- The treasury-split guard must also work for execution-only operators. Existing
-- split visibility does not include the executions section. Expose ONLY splits
-- attached to generated debts of an execution they can create/edit/delete.
CREATE POLICY payment_splits_execution_guard_read ON public.payment_splits FOR SELECT TO authenticated
USING ((public.app_permission_allowed('executions','create') OR public.app_permission_allowed('executions','edit') OR public.app_permission_allowed('executions','delete')) AND (
  (source_table='transactions' AND EXISTS(SELECT 1 FROM public.transactions t
    WHERE t.id=payment_splits.source_id AND t.source_service_type='execution'
      AND EXISTS(SELECT 1 FROM public.executions e WHERE e.id::text=split_part(t.source_service_id,'::',1))))
  OR (source_table='company_transactions' AND EXISTS(SELECT 1 FROM public.company_transactions t
    WHERE t.id=payment_splits.source_id AND t.source_service_type='execution'
      AND EXISTS(SELECT 1 FROM public.executions e WHERE e.id::text=split_part(t.source_service_id,'::',1))))
));
