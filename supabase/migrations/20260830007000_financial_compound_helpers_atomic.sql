-- ============================================================================
-- Atomic helpers for compound financial operations that are not simple inserts.
-- ============================================================================

-- 1) Expense hard-delete: reverse treasury splits + delete merchant/deduction
-- children + delete parent in one transaction.
CREATE OR REPLACE FUNCTION public.delete_expense_atomic(p_expense_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_parent public.expenses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_expense_id IS NULL THEN RAISE EXCEPTION 'معرّف المصروف مطلوب'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('expense:' || p_expense_id::text, 0));
  SELECT * INTO v_parent FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'reused', true);
  END IF;

  -- payment_splits DELETE trigger reverses cash_boxes.balance inside this tx.
  DELETE FROM public.payment_splits
   WHERE source_table = 'expenses' AND source_id = p_expense_id;
  DELETE FROM public.expense_deductions WHERE expense_id = p_expense_id;
  DELETE FROM public.merchant_cash_collections WHERE expense_id = p_expense_id;
  DELETE FROM public.expenses WHERE id = p_expense_id;

  RETURN jsonb_build_object('ok', true, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_expense_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_expense_atomic(uuid) TO authenticated, service_role;


-- 2) Cash-box opening balance: cash-box state + statement marker are one tx.
CREATE OR REPLACE FUNCTION public.sync_cash_box_opening_atomic(
  p_cash_box_id uuid,
  p_amount numeric,
  p_date date,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_box public.cash_boxes%ROWTYPE;
  v_prev_opening numeric;
  v_prev_balance numeric;
  v_new_balance numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_cash_box_id IS NULL THEN RAISE EXCEPTION 'معرّف الخزينة مطلوب'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'تاريخ الرصيد الافتتاحي مطلوب'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cash-box-opening:' || p_cash_box_id::text, 0));
  SELECT * INTO v_box FROM public.cash_boxes WHERE id = p_cash_box_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الخزينة غير موجودة'; END IF;

  v_prev_opening := COALESCE(v_box.opening_balance, 0);
  v_prev_balance := COALESCE(v_box.balance, 0);
  v_new_balance := v_prev_balance + COALESCE(p_amount, 0) - v_prev_opening;

  UPDATE public.cash_boxes
     SET opening_balance = COALESCE(p_amount, 0),
         opening_date = p_date,
         opening_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         balance = v_new_balance,
         updated_at = now()
   WHERE id = p_cash_box_id;

  DELETE FROM public.usd_treasury_transactions
   WHERE cash_box_id = p_cash_box_id
     AND source_service_type = 'opening';

  IF COALESCE(p_amount, 0) <> 0 THEN
    INSERT INTO public.usd_treasury_transactions (
      cash_box_id, date, type, usd_amount, egp_amount, exchange_rate,
      note, statement, source_service_type, source_service_id
    ) VALUES (
      p_cash_box_id, p_date, 'opening', 0, p_amount, NULL,
      NULLIF(btrim(COALESCE(p_note, '')), ''), 'رصيد افتتاحي', 'opening', p_cash_box_id
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'balance', v_new_balance, 'openingBalance', COALESCE(p_amount, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.sync_cash_box_opening_atomic(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_cash_box_opening_atomic(uuid, numeric, date, text) TO authenticated, service_role;


-- 3) Service posting: agent + company debt rows are synchronized together.
CREATE OR REPLACE FUNCTION public.sync_service_financials_atomic(
  p_service_id text,
  p_agent_row jsonb DEFAULT NULL,
  p_company_row jsonb DEFAULT NULL,
  p_delete boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_company_id uuid;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF COALESCE(btrim(p_service_id), '') = '' THEN RAISE EXCEPTION 'معرّف الخدمة مطلوب'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('service-financial:' || p_service_id, 0));

  SELECT count(*), min(id) INTO v_count, v_agent_id
  FROM public.transactions WHERE source_service_id = p_service_id;
  IF v_count > 1 THEN RAISE EXCEPTION 'توجد أكثر من حركة وكيل مرتبطة بنفس الخدمة'; END IF;

  SELECT count(*), min(id) INTO v_count, v_company_id
  FROM public.company_transactions WHERE source_service_id = p_service_id;
  IF v_count > 1 THEN RAISE EXCEPTION 'توجد أكثر من حركة شركة مرتبطة بنفس الخدمة'; END IF;

  IF p_delete THEN
    DELETE FROM public.transactions WHERE source_service_id = p_service_id;
    DELETE FROM public.company_transactions WHERE source_service_id = p_service_id;
    RETURN jsonb_build_object('ok', true, 'deleted', true);
  END IF;

  IF p_agent_row IS NOT NULL THEN
    IF jsonb_typeof(p_agent_row) <> 'object' THEN RAISE EXCEPTION 'بيانات طرف الوكيل غير صالحة'; END IF;
    IF v_agent_id IS NULL THEN
      INSERT INTO public.transactions (
        agent_id, date, destination, travel_statement, service_type, count, price,
        instapay_amount, cash_amount, mobile_cash_amount, mobile_cash_net_amount,
        arabic_tourism_cash_amount, arabic_tourism_cash_net_amount,
        merchant_cash_amount, merchant_cash_net_amount, merchant_cash_physical_amount,
        merchant_id, payment_method, total_paid, paid, note, source_service_id, source_service_type
      )
      SELECT
        x.agent_id, x.date, x.destination, x.travel_statement, x.service_type, x.count, x.price,
        x.instapay_amount, x.cash_amount, x.mobile_cash_amount, x.mobile_cash_net_amount,
        x.arabic_tourism_cash_amount, x.arabic_tourism_cash_net_amount,
        x.merchant_cash_amount, x.merchant_cash_net_amount, x.merchant_cash_physical_amount,
        x.merchant_id, x.payment_method, x.total_paid, x.paid, x.note, x.source_service_id, x.source_service_type
      FROM jsonb_populate_record(NULL::public.transactions, p_agent_row) x
      RETURNING id INTO v_agent_id;
    ELSE
      UPDATE public.transactions t SET
        agent_id = x.agent_id,
        date = x.date,
        destination = x.destination,
        travel_statement = x.travel_statement,
        service_type = x.service_type,
        count = x.count,
        price = x.price,
        note = x.note,
        source_service_type = x.source_service_type
      FROM jsonb_populate_record(NULL::public.transactions, p_agent_row) x
      WHERE t.id = v_agent_id;
    END IF;
  END IF;

  IF p_company_row IS NULL THEN
    IF v_company_id IS NOT NULL THEN
      DELETE FROM public.company_transactions WHERE id = v_company_id;
      v_company_id := NULL;
    END IF;
  ELSE
    IF jsonb_typeof(p_company_row) <> 'object' THEN RAISE EXCEPTION 'بيانات طرف الشركة غير صالحة'; END IF;
    IF v_company_id IS NULL THEN
      INSERT INTO public.company_transactions (
        company_id, date, destination, service_type, count, price, trip_value,
        instapay_amount, cash_amount, mobile_cash_amount, mobile_cash_net_amount,
        arabic_tourism_cash_amount, arabic_tourism_cash_net_amount,
        merchant_cash_amount, merchant_cash_net_amount, merchant_cash_physical_amount,
        merchant_id, total_paid, note, source_service_id, source_service_type
      )
      SELECT
        x.company_id, x.date, x.destination, x.service_type, x.count, x.price, x.trip_value,
        x.instapay_amount, x.cash_amount, x.mobile_cash_amount, x.mobile_cash_net_amount,
        x.arabic_tourism_cash_amount, x.arabic_tourism_cash_net_amount,
        x.merchant_cash_amount, x.merchant_cash_net_amount, x.merchant_cash_physical_amount,
        x.merchant_id, x.total_paid, x.note, x.source_service_id, x.source_service_type
      FROM jsonb_populate_record(NULL::public.company_transactions, p_company_row) x
      RETURNING id INTO v_company_id;
    ELSE
      UPDATE public.company_transactions t SET
        company_id = x.company_id,
        date = x.date,
        destination = x.destination,
        service_type = x.service_type,
        count = x.count,
        price = x.price,
        trip_value = x.trip_value,
        note = x.note,
        source_service_type = x.source_service_type
      FROM jsonb_populate_record(NULL::public.company_transactions, p_company_row) x
      WHERE t.id = v_company_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'agentTransactionId', v_agent_id, 'companyTransactionId', v_company_id);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_service_financials_atomic(text, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_service_financials_atomic(text, jsonb, jsonb, boolean) TO authenticated, service_role;
