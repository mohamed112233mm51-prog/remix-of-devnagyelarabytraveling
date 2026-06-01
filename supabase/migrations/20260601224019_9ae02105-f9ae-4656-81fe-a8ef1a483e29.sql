-- Enable Realtime for operational tables
-- Add tables to supabase_realtime publication so postgres_changes events are delivered
-- Set REPLICA IDENTITY FULL so UPDATE/DELETE events carry full old row

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'executions','submissions','transactions','agents','issuing_companies',
    'user_roles','profiles','system_dropdown_options',
    'flights','approvals','company_transactions','merchants',
    'merchant_cash_collections','investors','investor_transactions',
    'expenses','expense_deductions','usd_treasury_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;