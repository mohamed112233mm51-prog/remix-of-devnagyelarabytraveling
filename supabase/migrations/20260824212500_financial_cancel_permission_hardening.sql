-- Financial edit/cancel authorization hardening.
--
-- Financial cancellation is implemented as a soft UPDATE of cancelled_at /
-- cancelled_by / cancel_reason, while the UI models that operation as the
-- section's `delete` permission. A plain UPDATE policy cannot distinguish a
-- normal edit from a cancellation. This migration closes that gap:
--
--   * normal row changes require the same `edit` authorization as before;
--   * cancellation / restore metadata changes require `delete` authorization;
--   * a statement that changes cancellation metadata AND business fields must
--     satisfy both permissions;
--   * payment_splits use the existing source-aware permission resolver.
--
-- Commit/review first. Apply to the development Supabase project and run the
-- permission matrix tests before promoting it to production.

CREATE OR REPLACE FUNCTION public.app_financial_row_action_allowed(
  p_table text,
  p_row jsonb,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source_type text := COALESCE(p_row ->> 'source_service_type', '');
  v_agent_id text := NULLIF(p_row ->> 'agent_id', '');
  v_merchant_id text := NULLIF(p_row ->> 'merchant_id', '');
  v_expense_id text := NULLIF(p_row ->> 'expense_id', '');
  v_source_table text := NULLIF(p_row ->> 'source_table', '');
  v_source_id uuid := NULLIF(p_row ->> 'source_id', '')::uuid;
BEGIN
  IF p_action NOT IN ('edit', 'delete') THEN
    RETURN false;
  END IF;

  CASE p_table
    WHEN 'transactions' THEN
      IF p_action = 'edit' THEN
        RETURN
          public.app_financial_action_allowed('accounts', 'edit')
          OR (v_agent_id IS NULL AND v_merchant_id IS NOT NULL
              AND public.app_financial_action_allowed('merchants', 'edit'))
          OR (v_source_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
          OR (v_source_type = 'merchant_cash_out_to_company'
              AND public.app_financial_action_allowed('companies', 'edit'))
          OR (v_source_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
          OR (v_source_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
          OR (v_source_type IN ('flight_ticket','security_approval','libyan_investment')
              AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'));
      END IF;
      RETURN
        public.app_financial_action_allowed('accounts', 'delete')
        OR (v_agent_id IS NULL AND v_merchant_id IS NOT NULL
            AND public.app_financial_action_allowed('merchants', 'delete'))
        OR (v_source_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
        OR (v_source_type = 'merchant_cash_out_to_company'
            AND public.app_financial_action_allowed('companies', 'delete'))
        OR (v_source_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
        OR (v_source_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
        OR (v_source_type IN ('flight_ticket','security_approval','libyan_investment')
            AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'))
        OR (v_source_type IN ('opening_debit','opening_credit')
            AND public.app_permission_allowed('accounts', 'edit'));

    WHEN 'company_transactions' THEN
      IF p_action = 'edit' THEN
        RETURN
          public.app_financial_action_allowed('companies', 'edit')
          OR (v_source_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
          OR (v_source_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
          OR (v_source_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
          OR (v_source_type IN ('flight_ticket','security_approval','libyan_investment')
              AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'));
      END IF;
      RETURN
        public.app_financial_action_allowed('companies', 'delete')
        OR (v_source_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
        OR (v_source_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
        OR (v_source_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
        OR (v_source_type IN ('flight_ticket','security_approval','libyan_investment')
            AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'))
        OR (v_source_type IN ('opening_debit','opening_credit')
            AND public.app_permission_allowed('companies', 'edit'));

    WHEN 'merchant_cash_collections' THEN
      IF p_action = 'edit' THEN
        RETURN public.app_financial_action_allowed('merchants', 'edit');
      END IF;
      RETURN
        public.app_financial_action_allowed('merchants', 'delete')
        OR (v_expense_id IS NOT NULL AND public.app_permission_allowed('expenses', 'delete'))
        OR (v_source_type IN ('opening_debit','opening_credit')
            AND public.app_permission_allowed('merchants', 'edit'));

    WHEN 'currency_supplier_transactions' THEN
      IF p_action = 'edit' THEN
        RETURN public.app_financial_action_allowed('currency_suppliers', 'edit');
      END IF;
      RETURN
        public.app_financial_action_allowed('currency_suppliers', 'delete')
        OR (v_source_type IN ('opening_debit','opening_credit')
            AND public.app_permission_allowed('currency_suppliers', 'edit'));

    WHEN 'expense_deductions' THEN
      RETURN public.app_financial_action_allowed('expenses', p_action);

    WHEN 'usd_treasury_transactions' THEN
      IF p_action = 'edit' THEN
        RETURN public.app_financial_action_allowed('reports', 'edit');
      END IF;
      RETURN
        public.app_financial_action_allowed('reports', 'delete')
        OR public.app_permission_allowed('reports', 'edit');

    WHEN 'payment_splits' THEN
      RETURN public.app_payment_split_write_allowed(v_source_table, v_source_id, p_action);

    ELSE
      RETURN false;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.app_financial_row_action_allowed(text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financial_row_action_allowed(text, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_financial_row_action_allowed(text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_financial_update_intent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_cancel_changed boolean;
  v_business_changed boolean;
BEGIN
  v_cancel_changed :=
    (v_old -> 'cancelled_at') IS DISTINCT FROM (v_new -> 'cancelled_at')
    OR (v_old -> 'cancelled_by') IS DISTINCT FROM (v_new -> 'cancelled_by')
    OR (v_old -> 'cancel_reason') IS DISTINCT FROM (v_new -> 'cancel_reason');

  v_business_changed :=
    (v_old - ARRAY['cancelled_at','cancelled_by','cancel_reason'])
      IS DISTINCT FROM
    (v_new - ARRAY['cancelled_at','cancelled_by','cancel_reason']);

  IF v_cancel_changed
     AND NOT public.app_financial_row_action_allowed(TG_TABLE_NAME, v_old, 'delete') THEN
    RAISE EXCEPTION 'FINANCIAL_CANCEL_PERMISSION_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF v_business_changed
     AND NOT public.app_financial_row_action_allowed(TG_TABLE_NAME, v_old, 'edit') THEN
    RAISE EXCEPTION 'FINANCIAL_EDIT_PERMISSION_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_financial_update_intent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_financial_update_intent() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_financial_update_intent() FROM authenticated;

-- UPDATE RLS must admit either intent so the trigger can make the final,
-- column-aware decision. Without this, a delete-only user cannot perform the
-- soft-cancel UPDATE even though the UI correctly grants the cancel action.
DROP POLICY IF EXISTS transactions_perm_update ON public.transactions;
CREATE POLICY transactions_perm_update ON public.transactions
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('transactions', to_jsonb(transactions), 'edit')
  OR public.app_financial_row_action_allowed('transactions', to_jsonb(transactions), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('transactions', to_jsonb(transactions), 'edit')
  OR public.app_financial_row_action_allowed('transactions', to_jsonb(transactions), 'delete')
);

DROP POLICY IF EXISTS company_transactions_perm_update ON public.company_transactions;
CREATE POLICY company_transactions_perm_update ON public.company_transactions
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('company_transactions', to_jsonb(company_transactions), 'edit')
  OR public.app_financial_row_action_allowed('company_transactions', to_jsonb(company_transactions), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('company_transactions', to_jsonb(company_transactions), 'edit')
  OR public.app_financial_row_action_allowed('company_transactions', to_jsonb(company_transactions), 'delete')
);

DROP POLICY IF EXISTS merchant_collections_perm_update ON public.merchant_cash_collections;
CREATE POLICY merchant_collections_perm_update ON public.merchant_cash_collections
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('merchant_cash_collections', to_jsonb(merchant_cash_collections), 'edit')
  OR public.app_financial_row_action_allowed('merchant_cash_collections', to_jsonb(merchant_cash_collections), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('merchant_cash_collections', to_jsonb(merchant_cash_collections), 'edit')
  OR public.app_financial_row_action_allowed('merchant_cash_collections', to_jsonb(merchant_cash_collections), 'delete')
);

DROP POLICY IF EXISTS supplier_transactions_perm_update ON public.currency_supplier_transactions;
CREATE POLICY supplier_transactions_perm_update ON public.currency_supplier_transactions
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('currency_supplier_transactions', to_jsonb(currency_supplier_transactions), 'edit')
  OR public.app_financial_row_action_allowed('currency_supplier_transactions', to_jsonb(currency_supplier_transactions), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('currency_supplier_transactions', to_jsonb(currency_supplier_transactions), 'edit')
  OR public.app_financial_row_action_allowed('currency_supplier_transactions', to_jsonb(currency_supplier_transactions), 'delete')
);

DROP POLICY IF EXISTS expense_deductions_perm_update ON public.expense_deductions;
CREATE POLICY expense_deductions_perm_update ON public.expense_deductions
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('expense_deductions', to_jsonb(expense_deductions), 'edit')
  OR public.app_financial_row_action_allowed('expense_deductions', to_jsonb(expense_deductions), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('expense_deductions', to_jsonb(expense_deductions), 'edit')
  OR public.app_financial_row_action_allowed('expense_deductions', to_jsonb(expense_deductions), 'delete')
);

DROP POLICY IF EXISTS usd_treasury_perm_update ON public.usd_treasury_transactions;
CREATE POLICY usd_treasury_perm_update ON public.usd_treasury_transactions
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('usd_treasury_transactions', to_jsonb(usd_treasury_transactions), 'edit')
  OR public.app_financial_row_action_allowed('usd_treasury_transactions', to_jsonb(usd_treasury_transactions), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('usd_treasury_transactions', to_jsonb(usd_treasury_transactions), 'edit')
  OR public.app_financial_row_action_allowed('usd_treasury_transactions', to_jsonb(usd_treasury_transactions), 'delete')
);

DROP POLICY IF EXISTS payment_splits_perm_update ON public.payment_splits;
CREATE POLICY payment_splits_perm_update ON public.payment_splits
FOR UPDATE TO authenticated
USING (
  public.app_financial_row_action_allowed('payment_splits', to_jsonb(payment_splits), 'edit')
  OR public.app_financial_row_action_allowed('payment_splits', to_jsonb(payment_splits), 'delete')
)
WITH CHECK (
  public.app_financial_row_action_allowed('payment_splits', to_jsonb(payment_splits), 'edit')
  OR public.app_financial_row_action_allowed('payment_splits', to_jsonb(payment_splits), 'delete')
);

-- Column-intent guards. Drop/recreate makes the migration idempotent across
-- development resets.
DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.transactions;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();

DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.company_transactions;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.company_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();

DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.merchant_cash_collections;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.merchant_cash_collections
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();

DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.currency_supplier_transactions;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.currency_supplier_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();

DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.expense_deductions;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.expense_deductions
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();

DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.usd_treasury_transactions;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.usd_treasury_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();

DROP TRIGGER IF EXISTS financial_update_intent_guard ON public.payment_splits;
CREATE TRIGGER financial_update_intent_guard
BEFORE UPDATE ON public.payment_splits
FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_update_intent();
