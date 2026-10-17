-- Recover only durable, exact references recorded by the existing atomic engine.
-- Never infer a counterparty link from amount/date/name.
UPDATE public.merchant_cash_collections m
SET source_service_type='currency_supplier', source_service_id=t.id
FROM public.financial_operation_requests r
JOIN public.currency_supplier_transactions t ON t.id=r.operation_id
WHERE r.result->>'transactionId'=t.id::text
  AND jsonb_typeof(r.result->'merchantIds')='array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.result->'merchantIds') ids WHERE ids=m.id::text)
  AND m.expense_id IS NULL AND m.source_service_id IS NULL AND m.source_service_type IS NULL
  AND m.created_at=t.created_at AND m.date=t.tx_date
  AND r.created_by IS NOT DISTINCT FROM t.created_by
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.payment_splits)='array' THEN t.payment_splits ELSE '[]'::jsonb END) x
    WHERE x->>'source'='merchant' AND x->>'merchant_id'=m.merchant_id::text
      AND upper(COALESCE(x->>'currency','EGP'))=upper(COALESCE(m.opening_currency,'EGP'))
      AND (x->>'amount')::numeric*CASE WHEN t.tx_type IN ('شراء عملة','دفع نقدية') THEN 1 ELSE -1 END=m.amount);

CREATE INDEX IF NOT EXISTS merchant_collections_currency_parent_idx
ON public.merchant_cash_collections(source_service_type,source_service_id)
WHERE source_service_type='currency_supplier';

-- Keep linked updates under the owning section's existing edit permission.
CREATE POLICY merchant_collections_linked_expense_edit ON public.merchant_cash_collections
FOR UPDATE TO authenticated
USING (expense_id IS NOT NULL AND public.app_permission_allowed('expenses','edit')
  AND EXISTS (SELECT 1 FROM public.expenses e WHERE e.id=merchant_cash_collections.expense_id))
WITH CHECK (expense_id IS NOT NULL AND public.app_permission_allowed('expenses','edit')
  AND EXISTS (SELECT 1 FROM public.expenses e WHERE e.id=merchant_cash_collections.expense_id));
CREATE POLICY merchant_collections_linked_currency_edit ON public.merchant_cash_collections
FOR UPDATE TO authenticated
USING (source_service_type='currency_supplier' AND expense_id IS NULL
  AND public.app_financial_action_allowed('currency_suppliers','edit')
  AND EXISTS (SELECT 1 FROM public.currency_supplier_transactions t WHERE t.id=merchant_cash_collections.source_service_id))
WITH CHECK (source_service_type='currency_supplier' AND expense_id IS NULL
  AND public.app_financial_action_allowed('currency_suppliers','edit')
  AND EXISTS (SELECT 1 FROM public.currency_supplier_transactions t WHERE t.id=merchant_cash_collections.source_service_id));

-- Preserve the existing trigger/privilege boundary. On an edit within the SAME
-- box apply one net delta, avoiding a transient negative balance when an old
-- incoming amount has already been partly spent and is being increased.
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old numeric:=0; v_new numeric:=0;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.cancelled_at IS NULL THEN
    v_old:=COALESCE(OLD.amount,0)*CASE WHEN COALESCE(OLD.direction,'in')='out' THEN -1 ELSE 1 END;
  END IF;
  IF TG_OP<>'DELETE' AND NEW.cancelled_at IS NULL THEN
    v_new:=COALESCE(NEW.amount,0)*CASE WHEN COALESCE(NEW.direction,'in')='out' THEN -1 ELSE 1 END;
  END IF;
  IF TG_OP='UPDATE' AND NEW.cash_box_id IS NOT DISTINCT FROM OLD.cash_box_id THEN
    IF NEW.cash_box_id IS NOT NULL AND v_new<>v_old THEN
      UPDATE public.cash_boxes SET balance=COALESCE(balance,0)+v_new-v_old,updated_at=now() WHERE id=NEW.cash_box_id;
    END IF;
  ELSE
    IF TG_OP<>'INSERT' AND OLD.cash_box_id IS NOT NULL AND v_old<>0 THEN
      UPDATE public.cash_boxes SET balance=COALESCE(balance,0)-v_old,updated_at=now() WHERE id=OLD.cash_box_id;
    END IF;
    IF TG_OP<>'DELETE' AND NEW.cash_box_id IS NOT NULL AND v_new<>0 THEN
      UPDATE public.cash_boxes SET balance=COALESCE(balance,0)+v_new,updated_at=now() WHERE id=NEW.cash_box_id;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.apply_payment_split_to_cash_box() FROM PUBLIC,anon,authenticated;

-- Same financial edit RPC and same cash-box trigger; no parallel financial path.
-- Old clients cannot partially update expenses/currency transactions after this
-- migration: coupled edits require a current snapshot and a reason.

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
  -- Extend the existing edit transaction; no alternate posting engine/RPC.
  IF p_table IN ('expenses', 'currency_supplier_transactions') THEN
    DECLARE
      v_expected jsonb := p_parent_patch -> '_expected';
      v_reason text := btrim(p_parent_patch ->> '_reason');
      v_parent_patch jsonb := p_parent_patch - ARRAY['_expected','_reason','_amount'];
      v_funding jsonb := '[]';
      v_splits jsonb := '[]';
      v_targets jsonb := '{}';
      v_seen jsonb := '{}';
      v_payments jsonb := '[]';
      v_old_payments jsonb := '[]';
      v_item jsonb;
      v_old jsonb;
      v_new jsonb;
      v_rec record;
      v_group text;
      v_currency text;
      v_foreign text;
      v_kind text;
      v_old_amount numeric;
      v_amount numeric;
      v_ratio numeric := 1;
      v_sum numeric;
      v_target numeric;
      v_cumulative numeric;
      v_scaled numeric;
      v_old_paid numeric := 0;
      v_new_paid numeric := 0;
      v_old_egp numeric;
      v_new_egp numeric;
      v_commission numeric;
      v_changed boolean := false;
      v_date_changed boolean := false;
      v_trade boolean := false;
      v_out boolean := false;
      v_date date;
      v_after_child jsonb;
      v_key text;
      v_allowed text[];
    BEGIN
      IF jsonb_typeof(v_expected) IS DISTINCT FROM 'object'
        OR v_expected->>'id' IS DISTINCT FROM p_id::text
        OR NOT (v_expected ?& CASE WHEN p_table='expenses' THEN ARRAY['amount','date','currency']
          ELSE ARRAY['tx_type','tx_date','bought_amount','sold_amount','exchange_rate','payment_splits'] END)
        OR COALESCE(v_reason, '') = '' THEN
        RAISE EXCEPTION 'بيانات تأكيد التعديل وسببه مطلوبة';
      END IF;
      IF COALESCE(p_split_patches, '[]') <> '[]'::jsonb THEN
        RAISE EXCEPTION 'قيود المصروف والعملات تُحسب داخل المعاملة ولا تقبل تعديلات منفصلة';
      END IF;
      v_allowed := CASE WHEN p_table = 'expenses'
        THEN ARRAY['expense_name','expense_type','notes','statement','date','auto_deduct_enabled','auto_deduct_day']
        ELSE ARRAY['tx_date','description','statement'] END;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_parent_patch) k WHERE NOT k = ANY(v_allowed)) THEN
        RAISE EXCEPTION 'حقول تعديل غير مسموح بها لهذه الحركة';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(p_table || ':' || p_id::text, 0));
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE', p_table)
        INTO v_before USING p_id;
      IF v_before IS NULL THEN RAISE EXCEPTION 'الحركة غير موجودة أو غير مسموح بتعديلها'; END IF;
      IF NOT (v_expected <@ v_before) THEN
        RAISE EXCEPTION 'تم تعديل الحركة بواسطة مستخدم آخر؛ حدّث البيانات ثم أعد المحاولة';
      END IF;
      IF NULLIF(v_before ->> 'cancelled_at', '') IS NOT NULL THEN
        RAISE EXCEPTION 'لا يمكن تعديل حركة ملغاة';
      END IF;
      v_kind := v_before ->> 'tx_type';
      v_trade := p_table = 'currency_supplier_transactions' AND v_kind IN ('شراء عملة','بيع عملة');
      v_out := v_kind IN ('شراء عملة','دفع نقدية');
      v_old_amount := CASE
        WHEN p_table = 'expenses' THEN (v_before ->> 'amount')::numeric
        WHEN v_kind = 'بيع عملة' THEN (v_before ->> 'sold_amount')::numeric
        ELSE COALESCE(NULLIF((v_before ->> 'bought_amount')::numeric,0), (v_before ->> 'sold_amount')::numeric) END;
      v_amount := COALESCE((p_parent_patch ->> '_amount')::numeric, v_old_amount);
      IF v_amount IS NULL OR v_amount <= 0 OR v_amount::text IN ('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'المبلغ يجب أن يكون رقمًا صالحًا أكبر من صفر';
      END IF;
      v_changed := v_amount IS DISTINCT FROM v_old_amount;
      v_date := COALESCE((v_parent_patch ->> CASE WHEN p_table='expenses' THEN 'date' ELSE 'tx_date' END)::date,
        (v_before ->> CASE WHEN p_table='expenses' THEN 'date' ELSE 'tx_date' END)::date);
      v_date_changed := v_date IS DISTINCT FROM (v_before ->> CASE WHEN p_table='expenses' THEN 'date' ELSE 'tx_date' END)::date;
      IF v_changed THEN
        IF COALESCE(v_old_amount,0) <= 0 THEN RAISE EXCEPTION 'لا يمكن تعديل مبلغ حركة بدون أساس مالي صالح'; END IF;
        v_ratio := v_amount / v_old_amount;
      END IF;

      IF p_table = 'expenses' THEN
        IF v_changed AND (round(v_amount,2) <> v_amount OR upper(COALESCE(v_before->>'currency','EGP')) <> 'EGP') THEN
          RAISE EXCEPTION 'تعديل المصروف المدفوع يدعم المبالغ بالجنيه حتى منزلتين عشريتين؛ يلزم تسوية مستقلة للسجل القديم غير المطابق';
        END IF;
        FOR v_rec IN SELECT * FROM public.expense_deductions WHERE expense_id=p_id ORDER BY id FOR UPDATE LOOP
          IF v_rec.cancelled_at IS NOT NULL AND (v_changed OR v_date_changed) THEN
            RAISE EXCEPTION 'المصروف مرتبط بخصم ملغى؛ يلزم مراجعة السداد قبل تغيير المبلغ أو التاريخ';
          END IF;
          IF v_rec.cancelled_at IS NULL THEN
            v_funding := v_funding || jsonb_build_array(jsonb_build_object('table','expense_deductions','before',to_jsonb(v_rec),
              'group',COALESCE(v_rec.funding_source,'') || '|' || upper(COALESCE(v_rec.currency,'EGP'))));
          END IF;
        END LOOP;
        FOR v_rec IN SELECT * FROM public.merchant_cash_collections WHERE expense_id=p_id ORDER BY id FOR UPDATE LOOP
          IF v_rec.cancelled_at IS NOT NULL AND (v_changed OR v_date_changed) THEN RAISE EXCEPTION 'المصروف مرتبط بسداد تاجر ملغى'; END IF;
          IF v_rec.cancelled_at IS NULL THEN
            v_funding := v_funding || jsonb_build_array(jsonb_build_object('table','merchant_cash_collections','before',to_jsonb(v_rec)));
          END IF;
        END LOOP;
        IF v_changed OR v_date_changed THEN
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_funding) x
            WHERE COALESCE((x->'before'->>'amount')::numeric,0) <= 0
              OR COALESCE(x->'before'->>'deduction_date',x->'before'->>'date') IS DISTINCT FROM v_before->>'date') THEN
            RAISE EXCEPTION 'المصروف له سداد دوري أو غير مطابق؛ لا يمكن تغيير المبلغ أو التاريخ دون مراجعة الحركات';
          END IF;
        END IF;
        IF v_changed THEN
          SELECT COALESCE(sum((x->'before'->>'amount')::numeric),0) INTO v_sum FROM jsonb_array_elements(v_funding) x;
          IF abs(v_sum-v_old_amount) > 0.01 OR v_sum <= 0 THEN
            RAISE EXCEPTION 'لا يمكن تعديل قيمة مصروف لا تتطابق قيود سداده الموثقة مع قيمته';
          END IF;
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_funding) x
            WHERE upper(COALESCE(x->'before'->>'currency',x->'before'->>'opening_currency','EGP')) <> 'EGP') THEN
            RAISE EXCEPTION 'عملات سداد المصروف غير متطابقة؛ يلزم مراجعة السجل';
          END IF;
          -- Cumulative allocation keeps the EXACT total after cent rounding.
          v_ratio := v_amount / v_sum;
          v_cumulative := 0;
          FOR v_item IN SELECT value FROM jsonb_array_elements(v_funding) LOOP
            v_old := v_item->'before';
            v_scaled := round((v_cumulative+(v_old->>'amount')::numeric)*v_ratio,2)-round(v_cumulative*v_ratio,2);
            v_cumulative := v_cumulative+(v_old->>'amount')::numeric;
            IF v_scaled <= 0 THEN RAISE EXCEPTION 'المبلغ الجديد أصغر من توزيع وسائل السداد؛ راجع قيمة المصروف'; END IF;
            v_group := v_item->>'group';
            IF v_item->>'table'='expense_deductions' THEN
              v_targets := jsonb_set(v_targets,ARRAY[v_group],to_jsonb(COALESCE((v_targets->>v_group)::numeric,0)+v_scaled),true);
            END IF;
            v_seen := jsonb_set(v_seen,ARRAY[v_old->>'id'],to_jsonb(v_scaled),true);
          END LOOP;
        END IF;
        FOR v_rec IN SELECT s.* FROM public.payment_splits s
          WHERE s.cancelled_at IS NULL AND (
            (s.source_table='expenses' AND s.source_id=p_id)
            OR (s.source_table='expense_deductions' AND s.source_id IN
              (SELECT (x->'before'->>'id')::uuid FROM jsonb_array_elements(v_funding) x WHERE x->>'table'='expense_deductions')))
          ORDER BY s.id FOR UPDATE LOOP
          v_group := CASE WHEN v_rec.source_table='expense_deductions' THEN
            (SELECT x->>'group' FROM jsonb_array_elements(v_funding) x WHERE x->'before'->>'id'=v_rec.source_id::text)
            ELSE (CASE WHEN v_rec.method IN ('إنستاباي','company_instapay') THEN 'insta_company'
              WHEN v_rec.method IN ('نقدي','company_cash') THEN 'cash_company' ELSE '' END) || '|' || upper(v_rec.currency) END;
          v_splits := v_splits || jsonb_build_array(jsonb_build_object('before',to_jsonb(v_rec),'group',v_group));
        END LOOP;
        IF v_changed THEN
          -- A deduction is a presentation row; its matching treasury split is
          -- the only cash-box effect. Do not count both as separate payments.
          FOR v_group IN SELECT DISTINCT x->>'group' FROM jsonb_array_elements(v_funding) x WHERE x->>'table'='expense_deductions'
            UNION SELECT DISTINCT x->>'group' FROM jsonb_array_elements(v_splits) x LOOP
            SELECT COALESCE(sum((x->'before'->>'amount')::numeric),0) INTO v_sum FROM jsonb_array_elements(v_splits) x WHERE x->>'group'=v_group;
            IF abs(v_sum-COALESCE((SELECT sum((x->'before'->>'amount')::numeric) FROM jsonb_array_elements(v_funding) x
              WHERE x->>'table'='expense_deductions' AND x->>'group'=v_group),0))>0.01 OR v_sum<=0 THEN
              RAISE EXCEPTION 'خصومات المصروف لا تطابق قيود الخزينة المرتبطة';
            END IF;
          END LOOP;
          v_parent_patch := v_parent_patch || jsonb_build_object('amount',v_amount);
        END IF;
      ELSE
        IF v_changed THEN
          IF v_trade THEN
            v_foreign := CASE WHEN v_kind='شراء عملة' THEN v_before->>'bought_currency' ELSE v_before->>'sold_currency' END;
            IF v_foreign NOT IN ('USD','LYD') OR COALESCE((v_before->>'exchange_rate')::numeric,0)<=0
              OR round(v_amount,4)<>v_amount THEN RAISE EXCEPTION 'بيانات العملة أو سعر الصرف غير صالحة للتعديل'; END IF;
            v_commission := CASE WHEN v_kind='شراء عملة' THEN round(COALESCE((v_before->>'commission_amount')::numeric,0)*v_ratio,2) ELSE 0 END;
            v_new_egp := round(v_amount*(v_before->>'exchange_rate')::numeric+v_commission,2);
            v_old_egp := CASE WHEN v_kind='شراء عملة' THEN (v_before->>'sold_amount')::numeric ELSE (v_before->>'bought_amount')::numeric END;
            v_parent_patch := v_parent_patch || CASE WHEN v_kind='شراء عملة'
              THEN jsonb_build_object('bought_amount',v_amount,'sold_amount',v_new_egp,'commission_amount',v_commission)
              ELSE jsonb_build_object('sold_amount',v_amount,'bought_amount',v_new_egp) END;
          ELSE
            IF v_kind NOT IN ('دفع نقدية','استلام نقدية','رصيد سابق') OR round(v_amount,2)<>v_amount THEN
              RAISE EXCEPTION 'نوع الحركة أو دقة المبلغ غير مدعومة للتعديل';
            END IF;
            v_parent_patch := v_parent_patch || CASE WHEN COALESCE((v_before->>'bought_amount')::numeric,0)>0
              THEN jsonb_build_object('bought_amount',v_amount) ELSE jsonb_build_object('sold_amount',v_amount) END;
          END IF;
        END IF;
        v_old_payments := CASE WHEN jsonb_typeof(v_before->'payment_splits')='array' THEN v_before->'payment_splits' ELSE '[]'::jsonb END;
        IF v_changed THEN
          SELECT COALESCE(sum((x->>'amount')::numeric),0) INTO v_old_paid FROM jsonb_array_elements(v_old_payments) x;
          v_new_paid := round(v_old_paid*v_ratio,2);
          IF v_trade AND abs(v_old_paid-v_old_egp)<=0.01 THEN v_new_paid:=v_new_egp; END IF;
          v_cumulative:=0;
          FOR v_item IN SELECT value FROM jsonb_array_elements(v_old_payments) LOOP
            v_scaled := CASE WHEN v_old_paid>0 THEN round((v_cumulative+(v_item->>'amount')::numeric)*v_new_paid/v_old_paid,2)
              -round(v_cumulative*v_new_paid/v_old_paid,2) ELSE 0 END;
            v_cumulative:=v_cumulative+COALESCE((v_item->>'amount')::numeric,0);
            IF v_scaled<=0 THEN RAISE EXCEPTION 'المبلغ الجديد لا يسمح بالحفاظ على توزيع السداد'; END IF;
            v_payments:=v_payments || jsonb_build_array(v_item || jsonb_build_object('amount',v_scaled));
          END LOOP;
          IF v_new_paid > 0 OR jsonb_array_length(v_old_payments)>0 THEN
            v_parent_patch:=v_parent_patch || jsonb_build_object('payment_splits',v_payments);
          END IF;
        ELSE v_payments:=v_old_payments;
        END IF;
        FOR v_rec IN SELECT * FROM public.merchant_cash_collections
          WHERE source_service_type='currency_supplier' AND source_service_id=p_id ORDER BY id FOR UPDATE LOOP
          IF v_rec.cancelled_at IS NOT NULL AND (v_changed OR v_date_changed) THEN RAISE EXCEPTION 'الحركة مرتبطة بسداد تاجر ملغى'; END IF;
          IF v_rec.cancelled_at IS NULL THEN
            v_funding:=v_funding || jsonb_build_array(jsonb_build_object('table','merchant_cash_collections','before',to_jsonb(v_rec)));
          END IF;
        END LOOP;
        IF v_changed OR v_date_changed THEN
          -- An unlinked historical merchant payment is NEVER matched by name,
          -- amount, or date. Require the explicit persisted parent reference.
          FOR v_rec IN SELECT x->>'merchant_id' AS id, upper(COALESCE(x->>'currency','EGP')) AS currency,
            sum((x->>'amount')::numeric) AS amount FROM jsonb_array_elements(v_old_payments) x
            WHERE x->>'source'='merchant' GROUP BY 1,2 LOOP
            SELECT COALESCE(sum(abs((x->'before'->>'amount')::numeric)),0) INTO v_sum FROM jsonb_array_elements(v_funding) x
              WHERE x->'before'->>'merchant_id'=v_rec.id AND upper(COALESCE(x->'before'->>'opening_currency','EGP'))=v_rec.currency;
            IF abs(v_sum-v_rec.amount)>0.01 THEN RAISE EXCEPTION 'سداد التاجر القديم غير مربوط بمرجع موثوق؛ راجع ربط السداد قبل تعديل المبلغ'; END IF;
          END LOOP;
          FOR v_rec IN SELECT x->'before'->>'merchant_id' AS id, upper(COALESCE(x->'before'->>'opening_currency','EGP')) AS currency,
            sum((x->'before'->>'amount')::numeric) AS amount FROM jsonb_array_elements(v_funding) x GROUP BY 1,2 LOOP
            SELECT COALESCE(sum((x->>'amount')::numeric),0)*CASE WHEN v_out THEN 1 ELSE -1 END INTO v_sum
              FROM jsonb_array_elements(v_old_payments) x WHERE x->>'source'='merchant'
                AND x->>'merchant_id'=v_rec.id AND upper(COALESCE(x->>'currency','EGP'))=v_rec.currency;
            IF abs(v_sum-v_rec.amount)>0.01 THEN RAISE EXCEPTION 'الربط المالي للتاجر لا يطابق السداد الأصلي'; END IF;
          END LOOP;
        END IF;
        IF v_changed THEN
          FOR v_rec IN SELECT * FROM public.payment_splits WHERE source_table=p_table AND source_id=p_id AND cancelled_at IS NULL ORDER BY id FOR UPDATE LOOP
            v_group:=CASE WHEN v_trade AND v_rec.currency=v_foreign THEN 'foreign' ELSE 'payment' END;
            IF v_trade AND ((v_group='foreign' AND v_rec.direction<>CASE WHEN v_out THEN 'in' ELSE 'out' END)
              OR (v_group='payment' AND (v_rec.currency<>'EGP' OR v_rec.direction<>CASE WHEN v_out THEN 'out' ELSE 'in' END))) THEN
              RAISE EXCEPTION 'اتجاه أو عملة قيد الصفقة غير مطابق';
            END IF;
            v_splits:=v_splits || jsonb_build_array(jsonb_build_object('before',to_jsonb(v_rec),'group',v_group));
          END LOOP;
          IF v_trade THEN
            SELECT COALESCE(sum((x->'before'->>'amount')::numeric),0) INTO v_sum FROM jsonb_array_elements(v_splits) x WHERE x->>'group'='foreign';
            IF abs(v_sum-v_old_amount)>0.0001 THEN RAISE EXCEPTION 'قيد الخزينة الأجنبية لا يطابق حجم الصفقة'; END IF;
            v_targets:=jsonb_build_object('foreign',v_amount,'payment',v_new_paid);
          ELSE v_targets:=jsonb_build_object('payment',v_amount); END IF;
          SELECT COALESCE(sum((x->'before'->>'amount')::numeric),0) INTO v_sum FROM jsonb_array_elements(v_splits) x WHERE x->>'group'='payment';
          IF abs(v_sum-CASE WHEN v_trade THEN v_old_paid ELSE v_old_amount END)>0.01
            AND v_kind<>'رصيد سابق' THEN RAISE EXCEPTION 'قيمة السداد لا تطابق قيود الخزينة'; END IF;
        END IF;
      END IF;

      -- Lock affected boxes consistently; the existing balance trigger is the
      -- only writer of cash_boxes.balance for these edits.
      PERFORM 1 FROM public.cash_boxes WHERE id IN
        (SELECT (x->'before'->>'cash_box_id')::uuid FROM jsonb_array_elements(v_splits) x WHERE x->'before'->>'cash_box_id' IS NOT NULL)
        ORDER BY id FOR UPDATE;
      PERFORM 1 FROM public.merchants WHERE id IN
        (SELECT (x->'before'->>'merchant_id')::uuid FROM jsonb_array_elements(v_funding) x WHERE x->>'table'='merchant_cash_collections') ORDER BY id FOR UPDATE;

      IF v_changed THEN
        FOR v_group IN SELECT DISTINCT x->>'group' FROM jsonb_array_elements(v_splits) x LOOP
          SELECT sum((x->'before'->>'amount')::numeric) INTO v_sum FROM jsonb_array_elements(v_splits) x WHERE x->>'group'=v_group;
          v_target:=COALESCE((v_targets->>v_group)::numeric,0);
          v_cumulative:=0;
          FOR v_item IN SELECT value FROM jsonb_array_elements(v_splits) WHERE value->>'group'=v_group LOOP
            v_old:=v_item->'before';
            v_scaled:=round((v_cumulative+(v_old->>'amount')::numeric)*v_target/v_sum,CASE WHEN v_group='foreign' THEN 4 ELSE 2 END)
              -round(v_cumulative*v_target/v_sum,CASE WHEN v_group='foreign' THEN 4 ELSE 2 END);
            v_cumulative:=v_cumulative+(v_old->>'amount')::numeric;
            IF v_scaled<=0 THEN RAISE EXCEPTION 'المبلغ الجديد لا يسمح بالحفاظ على قيود السداد'; END IF;
            UPDATE public.payment_splits SET amount=v_scaled,
              gross_amount=round(COALESCE((v_old->>'gross_amount')::numeric,(v_old->>'amount')::numeric)*v_scaled/(v_old->>'amount')::numeric,4),
              net_amount=round(COALESCE((v_old->>'net_amount')::numeric,(v_old->>'amount')::numeric)*v_scaled/(v_old->>'amount')::numeric,4),
              merchant_commission_amount=round(COALESCE((v_old->>'merchant_commission_amount')::numeric,0)*v_scaled/(v_old->>'amount')::numeric,2),
              egp_equivalent=round(COALESCE((v_old->>'egp_equivalent')::numeric,0)*v_scaled/(v_old->>'amount')::numeric,2)
              WHERE id=(v_old->>'id')::uuid;
            GET DIAGNOSTICS v_updated=ROW_COUNT;
            IF v_updated<>1 THEN RAISE EXCEPTION 'تعذر تحديث قيد الخزينة أو صلاحياته'; END IF;
          END LOOP;
        END LOOP;
      END IF;
      IF v_changed OR v_date_changed THEN
        v_seen:=CASE WHEN p_table='expenses' THEN v_seen ELSE '{}'::jsonb END;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_funding) LOOP
          v_old:=v_item->'before';
          v_scaled:=(v_old->>'amount')::numeric;
          IF v_changed THEN
            IF p_table='expenses' THEN v_scaled:=(v_seen->>(v_old->>'id'))::numeric;
            ELSE
              v_key:=(v_old->>'merchant_id') || '|' || upper(COALESCE(v_old->>'opening_currency','EGP'));
              SELECT COALESCE(sum((x->>'amount')::numeric),0) INTO v_target FROM jsonb_array_elements(v_payments) x
                WHERE x->>'source'='merchant' AND x->>'merchant_id'=v_old->>'merchant_id'
                  AND upper(COALESCE(x->>'currency','EGP'))=upper(COALESCE(v_old->>'opening_currency','EGP'));
              SELECT COALESCE(sum(abs((x->'before'->>'amount')::numeric)),0) INTO v_sum FROM jsonb_array_elements(v_funding) x
                WHERE x->'before'->>'merchant_id'=v_old->>'merchant_id'
                  AND upper(COALESCE(x->'before'->>'opening_currency','EGP'))=upper(COALESCE(v_old->>'opening_currency','EGP'));
              v_cumulative:=COALESCE((v_seen->>v_key)::numeric,0);
              v_scaled:=round((v_cumulative+abs((v_old->>'amount')::numeric))*v_target/NULLIF(v_sum,0),2)-round(v_cumulative*v_target/NULLIF(v_sum,0),2);
              v_seen:=jsonb_set(v_seen,ARRAY[v_key],to_jsonb(v_cumulative+abs((v_old->>'amount')::numeric)),true);
              v_scaled:=v_scaled*CASE WHEN (v_old->>'amount')::numeric<0 THEN -1 ELSE 1 END;
            END IF;
          END IF;
          IF v_changed AND (v_scaled IS NULL OR v_scaled=0) THEN RAISE EXCEPTION 'المبلغ الجديد لا يسمح بتسوية السداد المرتبط'; END IF;
          -- Merchant current accounts may be negative; settle the linked row in this same transaction.
          IF v_item->>'table'='expense_deductions' THEN
            UPDATE public.expense_deductions SET amount=v_scaled,deduction_date=v_date WHERE id=(v_old->>'id')::uuid RETURNING to_jsonb(expense_deductions.*) INTO v_after_child;
          ELSE
            UPDATE public.merchant_cash_collections SET amount=v_scaled,date=v_date WHERE id=(v_old->>'id')::uuid RETURNING to_jsonb(merchant_cash_collections.*) INTO v_after_child;
          END IF;
          GET DIAGNOSTICS v_updated=ROW_COUNT;
          IF v_updated<>1 OR v_scaled IS NULL THEN RAISE EXCEPTION 'تعذر تسوية السداد المرتبط أو صلاحياته'; END IF;
          INSERT INTO public.financial_audit_log(table_name,record_id,action,reason,performed_by,before_value,after_value,entity_type,entity_id,reference_no)
            VALUES(v_item->>'table',(v_old->>'id')::uuid,'edit',v_reason,auth.uid(),v_old,v_after_child,
              CASE WHEN v_item->>'table'='expense_deductions' THEN 'expense' ELSE 'merchant' END,
              CASE WHEN v_item->>'table'='expense_deductions' THEN (v_old->>'expense_id')::uuid ELSE (v_old->>'merchant_id')::uuid END,v_date::text);
        END LOOP;
      END IF;
      IF p_table='expenses' AND v_parent_patch ? 'expense_name' AND btrim(v_parent_patch->>'expense_name')='' THEN RAISE EXCEPTION 'اسم المصروف مطلوب'; END IF;
      SELECT string_agg(format('%1$I=x.%1$I',key),', ') INTO v_set_sql FROM jsonb_object_keys(v_parent_patch) key;
      IF v_set_sql IS NOT NULL THEN
        EXECUTE format('UPDATE public.%1$I p SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) x WHERE p.id=$2',p_table,v_set_sql)
          USING v_parent_patch,p_id;
        GET DIAGNOSTICS v_updated=ROW_COUNT;
        IF v_updated<>1 THEN RAISE EXCEPTION 'تعذر تعديل الحركة أو صلاحياتها'; END IF;
      END IF;
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',p_table) INTO v_after USING p_id;
      INSERT INTO public.financial_audit_log(table_name,record_id,action,reason,performed_by,before_value,after_value,entity_type,entity_id,reference_no)
        VALUES(p_table,p_id,'edit',v_reason,auth.uid(),v_before,v_after,
          CASE WHEN p_table='expenses' THEN 'expense' ELSE 'currency_supplier' END,
          CASE WHEN p_table='expenses' THEN p_id ELSE (v_before->>'supplier_id')::uuid END,v_date::text);
      RETURN jsonb_build_object('ok',true,'before',v_before,'after',v_after);
    END;
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

  IF (p_table='expense_deductions' AND NULLIF(v_before->>'expense_id','') IS NOT NULL)
    OR (p_table='merchant_cash_collections' AND (NULLIF(v_before->>'expense_id','') IS NOT NULL OR v_before->>'source_service_type'='currency_supplier'))
    OR (p_table='payment_splits' AND (
      v_before->>'source_table' IN ('expenses','currency_supplier_transactions')
      OR (v_before->>'source_table'='expense_deductions' AND EXISTS(SELECT 1 FROM public.expense_deductions d WHERE d.id=(v_before->>'source_id')::uuid AND d.expense_id IS NOT NULL)))) THEN
    RAISE EXCEPTION 'عدّل السجل الأصلي للمصروف أو حركة العملة لتسوية كل القيود معًا';
  END IF;

  -- Lock all referenced split rows before changing any amount. This serialises
  -- simultaneous edits/cancellations of the same treasury rows.
  FOR v_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_split_patches, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_patch) <> 'object' OR NOT (v_patch ? 'id') THEN
      RAISE EXCEPTION 'تعديل payment_split غير صالح';
    END IF;
    v_split_id := (v_patch ->> 'id')::uuid;
    PERFORM 1 FROM public.payment_splits WHERE id = v_split_id
      AND ((p_table='payment_splits' AND id=p_id)
        OR (source_table=p_table AND source_id=p_id)) FOR UPDATE;
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

