DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'merchants','merchant_cash_collections',
    'company_transactions',
    'currency_suppliers','currency_supplier_transactions',
    'expenses','expense_deductions',
    'investors','investor_transactions',
    'usd_treasury_transactions',
    'financial_audit_log'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;