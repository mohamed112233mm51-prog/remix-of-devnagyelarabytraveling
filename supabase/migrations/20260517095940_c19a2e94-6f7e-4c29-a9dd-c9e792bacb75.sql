
-- Lock down all currently public tables to authenticated users only
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agents','agent_service_pricing','approvals','flights','transactions',
    'company_transactions','investors','investor_transactions','merchants',
    'merchant_cash_collections','issuing_companies','expenses','expense_deductions',
    'usd_treasury_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS open_all ON public.%I', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_auth_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t||'_auth_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t||'_auth_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)', t||'_auth_delete', t);
  END LOOP;
END $$;
