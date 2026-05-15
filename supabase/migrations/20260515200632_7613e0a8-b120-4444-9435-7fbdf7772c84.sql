
-- Ensure full row data is sent on UPDATE/DELETE for realtime subscribers
ALTER TABLE public.agents REPLICA IDENTITY FULL;
ALTER TABLE public.flights REPLICA IDENTITY FULL;
ALTER TABLE public.approvals REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.issuing_companies REPLICA IDENTITY FULL;
ALTER TABLE public.company_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.merchants REPLICA IDENTITY FULL;
ALTER TABLE public.merchant_cash_collections REPLICA IDENTITY FULL;
ALTER TABLE public.investors REPLICA IDENTITY FULL;
ALTER TABLE public.investor_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.expenses REPLICA IDENTITY FULL;
ALTER TABLE public.expense_deductions REPLICA IDENTITY FULL;
ALTER TABLE public.system_dropdown_options REPLICA IDENTITY FULL;

-- Add tables to the realtime publication so all clients receive INSERT/UPDATE/DELETE events
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agents','flights','approvals','transactions','issuing_companies',
    'company_transactions','merchants','merchant_cash_collections',
    'investors','investor_transactions','expenses','expense_deductions',
    'system_dropdown_options'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
