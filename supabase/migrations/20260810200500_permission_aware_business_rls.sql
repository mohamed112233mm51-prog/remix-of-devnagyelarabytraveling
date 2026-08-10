-- ============================================================================
-- Permission-aware RLS hardening for business + financial data.
--
-- Goal:
--   Replace "any authenticated user can read/write everything" policies with
--   the same section/action permissions used by the application UI.
--
-- Design constraints:
--   * Admin / super-admin keep the normal section bypass used by the app.
--   * Disabled / unaccepted profiles are denied at the database layer.
--   * Dashboard/reports can still read the cross-section data they aggregate.
--   * Execution posting can still create/re-post linked agent/company ledger rows.
--   * Currency-supplier flows can still mirror merchant side-effects.
--   * payment_splits remains the authoritative cash movement table, but writes
--     are source-aware instead of open to every signed-in account.
--   * cash_boxes.balance updates performed by the payment_splits trigger run as
--     a locked SECURITY DEFINER trigger; direct cash-box writes remain restricted.
--
-- IMPORTANT: committing this migration does NOT apply it to a database. Apply
-- it to the development Supabase project first and test all permission profiles
-- before promoting to production.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Permission helpers. These are SECURITY INVOKER (the safe/default model):
--    they can only see the caller's own profile through existing profile RLS.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_permission_allowed(
  p_section text,
  p_action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT
      p.is_active = true
      AND p.invite_accepted = true
      AND (
        p.is_super_admin = true
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR (p.permissions -> p_section) = 'true'::jsonb
        OR (
          jsonb_typeof(p.permissions -> p_section) = 'object'
          AND CASE
            WHEN p_action = 'view' THEN
              CASE
                -- Matches checkPerm(): an explicit view=false wins.
                WHEN (p.permissions -> p_section) ? 'view'
                  THEN COALESCE((p.permissions -> p_section ->> 'view') = 'true', false)
                ELSE
                  COALESCE((p.permissions -> p_section ->> 'create') = 'true', false)
                  OR COALESCE((p.permissions -> p_section ->> 'edit') = 'true', false)
                  OR COALESCE((p.permissions -> p_section ->> 'delete') = 'true', false)
                  OR COALESCE((p.permissions -> p_section ->> 'export') = 'true', false)
              END
            ELSE COALESCE((p.permissions -> p_section ->> p_action) = 'true', false)
          END
        )
      )
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), false);
$$;

REVOKE ALL ON FUNCTION public.app_permission_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_permission_allowed(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_permission_allowed(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.app_has_any_permission(
  p_sections text[],
  p_action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_sections, ARRAY[]::text[])) AS s(section_key)
    WHERE public.app_permission_allowed(s.section_key, p_action)
  );
$$;

REVOKE ALL ON FUNCTION public.app_has_any_permission(text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_has_any_permission(text[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_has_any_permission(text[], text) TO authenticated, service_role;

-- Financial row edit/cancel follows the same rule as checkFinancialActionPerm:
-- either the section owns the action OR the legacy blanket permission does.
CREATE OR REPLACE FUNCTION public.app_financial_action_allowed(
  p_owner_section text,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    public.app_permission_allowed(p_owner_section, p_action)
    OR CASE
      WHEN p_action = 'edit'
        THEN public.app_permission_allowed('financial_transaction_update', 'edit')
      WHEN p_action = 'delete'
        THEN public.app_permission_allowed('financial_cancel', 'delete')
      ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.app_financial_action_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_financial_action_allowed(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_financial_action_allowed(text, text) TO authenticated, service_role;

-- payment_splits is cross-cutting. Authorize by the parent/source section.
CREATE OR REPLACE FUNCTION public.app_payment_split_write_allowed(
  p_source_table text,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE COALESCE(p_source_table, '')
    WHEN 'transactions' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('accounts', 'create')
          OR public.app_permission_allowed('merchants', 'create')
          OR public.app_permission_allowed('executions', 'edit')
        ELSE public.app_financial_action_allowed('accounts', p_action)
          OR public.app_financial_action_allowed('merchants', p_action)
          OR public.app_permission_allowed('executions', 'edit')
      END
    WHEN 'company_transactions' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('companies', 'create')
          OR public.app_permission_allowed('executions', 'edit')
        ELSE public.app_financial_action_allowed('companies', p_action)
          OR public.app_permission_allowed('executions', 'edit')
      END
    WHEN 'currency_supplier_transactions' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('currency_suppliers', 'create')
        ELSE public.app_financial_action_allowed('currency_suppliers', p_action)
      END
    WHEN 'merchant_cash_collections' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('merchants', 'create')
        ELSE public.app_financial_action_allowed('merchants', p_action)
      END
    WHEN 'investor_transactions' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('investors', 'create')
        ELSE public.app_financial_action_allowed('investors', p_action)
      END
    WHEN 'expense_deductions' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('expenses', 'create')
        ELSE public.app_financial_action_allowed('expenses', p_action)
      END
    WHEN 'expenses' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('expenses', 'create')
        ELSE public.app_financial_action_allowed('expenses', p_action)
      END
    WHEN 'usd_treasury_transactions' THEN
      CASE WHEN p_action = 'create'
        THEN public.app_permission_allowed('reports', 'create')
        ELSE public.app_financial_action_allowed('reports', p_action)
      END
    WHEN 'cash_transfers' THEN
      public.app_permission_allowed('reports', CASE WHEN p_action = 'delete' THEN 'delete' ELSE 'edit' END)
    WHEN 'cash_box_transfer' THEN
      public.app_permission_allowed('reports', CASE WHEN p_action = 'delete' THEN 'delete' ELSE 'edit' END)
    ELSE
      -- Legacy rows with no recognized source can only be changed by the
      -- explicit blanket financial permission (admins still bypass it).
      CASE
        WHEN p_action = 'edit'
          THEN public.app_permission_allowed('financial_transaction_update', 'edit')
        WHEN p_action = 'delete'
          THEN public.app_permission_allowed('financial_cancel', 'delete')
        ELSE false
      END
  END;
$$;

REVOKE ALL ON FUNCTION public.app_payment_split_write_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_payment_split_write_allowed(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_payment_split_write_allowed(text, text) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2) Lock the cash-box balance trigger. A client may insert an authorized
--    payment_split; the trigger, not the client, owns the resulting balance
--    mutation. Trigger functions do not need client EXECUTE grants.
-- --------------------------------------------------------------------------
ALTER FUNCTION public.apply_payment_split_to_cash_box() SECURITY DEFINER;
ALTER FUNCTION public.apply_payment_split_to_cash_box() SET search_path = public;
REVOKE ALL ON FUNCTION public.apply_payment_split_to_cash_box() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_payment_split_to_cash_box() FROM anon;
REVOKE ALL ON FUNCTION public.apply_payment_split_to_cash_box() FROM authenticated;

-- --------------------------------------------------------------------------
-- 3) Remove broad policies from the core tables and recreate least-privilege
--    policies. Grants remain; RLS is the row/action security boundary.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  r record;
  targets text[] := ARRAY[
    'agents',
    'issuing_companies',
    'merchants',
    'currency_suppliers',
    'investors',
    'transactions',
    'company_transactions',
    'merchant_cash_collections',
    'currency_supplier_transactions',
    'investor_transactions',
    'expenses',
    'expense_deductions',
    'usd_treasury_transactions',
    'submissions',
    'executions',
    'payment_splits',
    'cash_boxes',
    'company_pricing_rules'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ---- Master entities -------------------------------------------------------
CREATE POLICY agents_perm_select ON public.agents
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['accounts','submissions','executions','reports','dashboard','financial_position_view'], 'view')
);
CREATE POLICY agents_perm_insert ON public.agents
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('accounts','create'));
CREATE POLICY agents_perm_update ON public.agents
FOR UPDATE TO authenticated USING (public.app_permission_allowed('accounts','edit'))
WITH CHECK (public.app_permission_allowed('accounts','edit'));
CREATE POLICY agents_perm_delete ON public.agents
FOR DELETE TO authenticated USING (public.app_permission_allowed('accounts','delete'));

CREATE POLICY companies_perm_select ON public.issuing_companies
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['companies','submissions','executions','reports','dashboard','service_pricing_manage','service_price_search','financial_position_view'], 'view')
);
CREATE POLICY companies_perm_insert ON public.issuing_companies
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('companies','create'));
CREATE POLICY companies_perm_update ON public.issuing_companies
FOR UPDATE TO authenticated USING (public.app_permission_allowed('companies','edit'))
WITH CHECK (public.app_permission_allowed('companies','edit'));
CREATE POLICY companies_perm_delete ON public.issuing_companies
FOR DELETE TO authenticated USING (public.app_permission_allowed('companies','delete'));

CREATE POLICY merchants_perm_select ON public.merchants
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['merchants','accounts','companies','currency_suppliers','investors','expenses','reports','dashboard','financial_position_view'], 'view')
);
CREATE POLICY merchants_perm_insert ON public.merchants
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('merchants','create'));
CREATE POLICY merchants_perm_update ON public.merchants
FOR UPDATE TO authenticated USING (public.app_permission_allowed('merchants','edit'))
WITH CHECK (public.app_permission_allowed('merchants','edit'));
CREATE POLICY merchants_perm_delete ON public.merchants
FOR DELETE TO authenticated USING (public.app_permission_allowed('merchants','delete'));

CREATE POLICY currency_suppliers_perm_select ON public.currency_suppliers
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['currency_suppliers','reports','dashboard','financial_position_view'], 'view')
);
CREATE POLICY currency_suppliers_perm_insert ON public.currency_suppliers
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('currency_suppliers','create'));
CREATE POLICY currency_suppliers_perm_update ON public.currency_suppliers
FOR UPDATE TO authenticated USING (public.app_permission_allowed('currency_suppliers','edit'))
WITH CHECK (public.app_permission_allowed('currency_suppliers','edit'));
CREATE POLICY currency_suppliers_perm_delete ON public.currency_suppliers
FOR DELETE TO authenticated USING (public.app_permission_allowed('currency_suppliers','delete'));

CREATE POLICY investors_perm_select ON public.investors
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['investors','financial_position_view'], 'view')
);
CREATE POLICY investors_perm_insert ON public.investors
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('investors','create'));
CREATE POLICY investors_perm_update ON public.investors
FOR UPDATE TO authenticated USING (public.app_permission_allowed('investors','edit'))
WITH CHECK (public.app_permission_allowed('investors','edit'));
CREATE POLICY investors_perm_delete ON public.investors
FOR DELETE TO authenticated USING (public.app_permission_allowed('investors','delete'));

-- ---- Operational tables ----------------------------------------------------
CREATE POLICY submissions_perm_select ON public.submissions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['submissions','executions','reports','dashboard'], 'view')
);
CREATE POLICY submissions_perm_insert ON public.submissions
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('submissions','create'));
CREATE POLICY submissions_perm_update ON public.submissions
FOR UPDATE TO authenticated USING (
  public.app_permission_allowed('submissions','edit') OR public.app_permission_allowed('executions','create')
) WITH CHECK (
  public.app_permission_allowed('submissions','edit') OR public.app_permission_allowed('executions','create')
);
CREATE POLICY submissions_perm_delete ON public.submissions
FOR DELETE TO authenticated USING (public.app_permission_allowed('submissions','delete'));

CREATE POLICY executions_perm_select ON public.executions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['executions','submissions','reports','dashboard'], 'view')
);
CREATE POLICY executions_perm_insert ON public.executions
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('executions','create'));
CREATE POLICY executions_perm_update ON public.executions
FOR UPDATE TO authenticated USING (public.app_permission_allowed('executions','edit'))
WITH CHECK (public.app_permission_allowed('executions','edit'));
CREATE POLICY executions_perm_delete ON public.executions
FOR DELETE TO authenticated USING (public.app_permission_allowed('executions','delete'));

-- ---- Ledger / financial parent tables -------------------------------------
CREATE POLICY transactions_perm_select ON public.transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['accounts','merchants','reports','dashboard','financial_position_view'], 'view')
);
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
    source_service_type IN ('opening_debit','opening_credit')
    AND public.app_permission_allowed('accounts','edit')
  )
);
CREATE POLICY transactions_perm_update ON public.transactions
FOR UPDATE TO authenticated USING (
  public.app_financial_action_allowed('accounts','edit')
  OR (agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_financial_action_allowed('merchants','edit'))
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
) WITH CHECK (
  public.app_financial_action_allowed('accounts','edit')
  OR (agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_financial_action_allowed('merchants','edit'))
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
);
CREATE POLICY transactions_perm_delete ON public.transactions
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('accounts','delete')
  OR (agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_financial_action_allowed('merchants','delete'))
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('accounts','edit'))
);

CREATE POLICY company_transactions_perm_select ON public.company_transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['companies','reports','dashboard','financial_position_view'], 'view')
);
CREATE POLICY company_transactions_perm_insert ON public.company_transactions
FOR INSERT TO authenticated WITH CHECK (
  public.app_permission_allowed('companies','create')
  OR (
    source_service_type = 'execution'
    AND public.app_permission_allowed('executions','edit')
    AND EXISTS (
      SELECT 1 FROM public.executions e
      WHERE e.id::text = split_part(COALESCE(source_service_id,''), '::', 1)
    )
  )
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('companies','edit'))
);
CREATE POLICY company_transactions_perm_update ON public.company_transactions
FOR UPDATE TO authenticated USING (
  public.app_financial_action_allowed('companies','edit')
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
) WITH CHECK (
  public.app_financial_action_allowed('companies','edit')
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
);
CREATE POLICY company_transactions_perm_delete ON public.company_transactions
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('companies','delete')
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('companies','edit'))
);

CREATE POLICY merchant_collections_perm_select ON public.merchant_cash_collections
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['merchants','accounts','currency_suppliers','reports','dashboard','financial_position_view'], 'view')
);
CREATE POLICY merchant_collections_perm_insert ON public.merchant_cash_collections
FOR INSERT TO authenticated WITH CHECK (
  public.app_permission_allowed('merchants','create')
  OR public.app_permission_allowed('currency_suppliers','create')
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('merchants','edit'))
);
CREATE POLICY merchant_collections_perm_update ON public.merchant_cash_collections
FOR UPDATE TO authenticated USING (public.app_financial_action_allowed('merchants','edit'))
WITH CHECK (public.app_financial_action_allowed('merchants','edit'));
CREATE POLICY merchant_collections_perm_delete ON public.merchant_cash_collections
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('merchants','delete')
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('merchants','edit'))
);

CREATE POLICY supplier_transactions_perm_select ON public.currency_supplier_transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['currency_suppliers','reports','dashboard','financial_position_view'], 'view')
);
CREATE POLICY supplier_transactions_perm_insert ON public.currency_supplier_transactions
FOR INSERT TO authenticated WITH CHECK (
  public.app_permission_allowed('currency_suppliers','create')
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('currency_suppliers','edit'))
);
CREATE POLICY supplier_transactions_perm_update ON public.currency_supplier_transactions
FOR UPDATE TO authenticated USING (public.app_financial_action_allowed('currency_suppliers','edit'))
WITH CHECK (public.app_financial_action_allowed('currency_suppliers','edit'));
CREATE POLICY supplier_transactions_perm_delete ON public.currency_supplier_transactions
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('currency_suppliers','delete')
  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('currency_suppliers','edit'))
);

CREATE POLICY investor_transactions_perm_select ON public.investor_transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['investors','financial_position_view'], 'view')
);
CREATE POLICY investor_transactions_perm_insert ON public.investor_transactions
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('investors','create'));
CREATE POLICY investor_transactions_perm_update ON public.investor_transactions
FOR UPDATE TO authenticated USING (public.app_financial_action_allowed('investors','edit'))
WITH CHECK (public.app_financial_action_allowed('investors','edit'));
CREATE POLICY investor_transactions_perm_delete ON public.investor_transactions
FOR DELETE TO authenticated USING (public.app_financial_action_allowed('investors','delete'));

CREATE POLICY expenses_perm_select ON public.expenses
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['expenses','reports','dashboard'], 'view')
);
CREATE POLICY expenses_perm_insert ON public.expenses
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('expenses','create'));
CREATE POLICY expenses_perm_update ON public.expenses
FOR UPDATE TO authenticated USING (public.app_permission_allowed('expenses','edit'))
WITH CHECK (public.app_permission_allowed('expenses','edit'));
CREATE POLICY expenses_perm_delete ON public.expenses
FOR DELETE TO authenticated USING (public.app_permission_allowed('expenses','delete'));

CREATE POLICY expense_deductions_perm_select ON public.expense_deductions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['expenses','reports','dashboard'], 'view')
);
CREATE POLICY expense_deductions_perm_insert ON public.expense_deductions
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('expenses','create'));
CREATE POLICY expense_deductions_perm_update ON public.expense_deductions
FOR UPDATE TO authenticated USING (public.app_financial_action_allowed('expenses','edit'))
WITH CHECK (public.app_financial_action_allowed('expenses','edit'));
CREATE POLICY expense_deductions_perm_delete ON public.expense_deductions
FOR DELETE TO authenticated USING (public.app_financial_action_allowed('expenses','delete'));

CREATE POLICY usd_treasury_perm_select ON public.usd_treasury_transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['reports','dashboard'], 'view')
);
CREATE POLICY usd_treasury_perm_insert ON public.usd_treasury_transactions
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('reports','edit'));
CREATE POLICY usd_treasury_perm_update ON public.usd_treasury_transactions
FOR UPDATE TO authenticated USING (public.app_financial_action_allowed('reports','edit'))
WITH CHECK (public.app_financial_action_allowed('reports','edit'));
CREATE POLICY usd_treasury_perm_delete ON public.usd_treasury_transactions
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('reports','delete') OR public.app_permission_allowed('reports','edit')
);

-- ---- Cash boxes + payment splits ------------------------------------------
CREATE POLICY cash_boxes_perm_select ON public.cash_boxes
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(
    ARRAY['accounts','companies','merchants','currency_suppliers','investors','expenses','reports','dashboard','financial_position_view'],
    'view'
  )
);
CREATE POLICY cash_boxes_perm_insert ON public.cash_boxes
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('reports','create'));
CREATE POLICY cash_boxes_perm_update ON public.cash_boxes
FOR UPDATE TO authenticated USING (public.app_permission_allowed('reports','edit'))
WITH CHECK (public.app_permission_allowed('reports','edit'));
CREATE POLICY cash_boxes_perm_delete ON public.cash_boxes
FOR DELETE TO authenticated USING (public.app_permission_allowed('reports','delete'));

CREATE POLICY payment_splits_perm_select ON public.payment_splits
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(
    ARRAY['accounts','companies','merchants','currency_suppliers','investors','expenses','reports','dashboard','financial_position_view'],
    'view'
  )
);
CREATE POLICY payment_splits_perm_insert ON public.payment_splits
FOR INSERT TO authenticated WITH CHECK (
  public.app_payment_split_write_allowed(source_table, 'create')
);
CREATE POLICY payment_splits_perm_update ON public.payment_splits
FOR UPDATE TO authenticated USING (
  public.app_payment_split_write_allowed(source_table, 'edit')
) WITH CHECK (
  public.app_payment_split_write_allowed(source_table, 'edit')
);
CREATE POLICY payment_splits_perm_delete ON public.payment_splits
FOR DELETE TO authenticated USING (
  public.app_payment_split_write_allowed(source_table, 'delete')
);

-- ---- Pricing ---------------------------------------------------------------
CREATE POLICY pricing_rules_perm_select ON public.company_pricing_rules
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['service_pricing_manage','service_price_search','executions'], 'view')
);
CREATE POLICY pricing_rules_perm_insert ON public.company_pricing_rules
FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('service_pricing_manage','create'));
CREATE POLICY pricing_rules_perm_update ON public.company_pricing_rules
FOR UPDATE TO authenticated USING (public.app_permission_allowed('service_pricing_manage','edit'))
WITH CHECK (public.app_permission_allowed('service_pricing_manage','edit'));
CREATE POLICY pricing_rules_perm_delete ON public.company_pricing_rules
FOR DELETE TO authenticated USING (public.app_permission_allowed('service_pricing_manage','delete'));

-- --------------------------------------------------------------------------
-- 4) Remove execute access to trigger-only cash-box guards as defense-in-depth.
--    (They continue to run as triggers.)
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enforce_cash_box_non_negative_balance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_cash_box_non_negative_balance() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_cash_box_non_negative_balance() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_cash_box_non_negative_balance_ins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_cash_box_non_negative_balance_ins() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_cash_box_non_negative_balance_ins() FROM authenticated;
