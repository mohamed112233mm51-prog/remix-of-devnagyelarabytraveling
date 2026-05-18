-- Enable realtime for all core tables + ensure full row payload on update/delete
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agents','issuing_companies','merchants','flights','approvals',
    'transactions','company_transactions','investors','investor_transactions',
    'expenses','expense_deductions','merchant_cash_collections',
    'agent_service_pricing','profiles','user_roles','app_settings',
    'system_dropdown_options','activity_logs','backup_logs','import_batches'
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