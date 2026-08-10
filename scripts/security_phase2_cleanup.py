from pathlib import Path
import re

path = Path('supabase/migrations/20260810200500_permission_aware_business_rls.sql')
text = path.read_text(encoding='utf-8')
original = text

start = text.index('CREATE POLICY transactions_perm_select ON public.transactions')
end = text.index('CREATE POLICY merchant_collections_perm_select ON public.merchant_cash_collections')

clean_block = r'''CREATE POLICY transactions_perm_select ON public.transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['accounts','companies','merchants','submissions','executions','reports','dashboard','financial_position_view'], 'view')
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
    source_service_type = 'merchant_cash_out_to_company'
    AND agent_id IS NULL AND merchant_id IS NOT NULL
    AND public.app_permission_allowed('companies','create')
  )
  OR (
    source_service_type = 'merchant_cash_out_to_agent'
    AND agent_id IS NULL AND merchant_id IS NOT NULL
    AND public.app_permission_allowed('accounts','create')
  )
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
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
  OR (source_service_type = 'merchant_cash_out_to_company' AND public.app_financial_action_allowed('companies','edit'))
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
) WITH CHECK (
  public.app_financial_action_allowed('accounts','edit')
  OR (agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_financial_action_allowed('merchants','edit'))
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type = 'merchant_cash_out_to_company' AND public.app_financial_action_allowed('companies','edit'))
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
);
CREATE POLICY transactions_perm_delete ON public.transactions
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('accounts','delete')
  OR (agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_financial_action_allowed('merchants','delete'))
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type = 'merchant_cash_out_to_company' AND public.app_financial_action_allowed('companies','delete'))
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
  OR (
    source_service_type IN ('opening_debit','opening_credit')
    AND public.app_permission_allowed('accounts','edit')
  )
);

CREATE POLICY company_transactions_perm_select ON public.company_transactions
FOR SELECT TO authenticated USING (
  public.app_has_any_permission(ARRAY['companies','submissions','executions','reports','dashboard','financial_position_view'], 'view')
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
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
  OR (
    source_service_type IN ('opening_debit','opening_credit')
    AND public.app_permission_allowed('companies','edit')
  )
);
CREATE POLICY company_transactions_perm_update ON public.company_transactions
FOR UPDATE TO authenticated USING (
  public.app_financial_action_allowed('companies','edit')
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
) WITH CHECK (
  public.app_financial_action_allowed('companies','edit')
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
);
CREATE POLICY company_transactions_perm_delete ON public.company_transactions
FOR DELETE TO authenticated USING (
  public.app_financial_action_allowed('companies','delete')
  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))
  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))
  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))
  OR (
    source_service_type IN ('flight_ticket','security_approval','libyan_investment')
    AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit')
  )
  OR (
    source_service_type IN ('opening_debit','opening_credit')
    AND public.app_permission_allowed('companies','edit')
  )
);

'''

text = text[:start] + clean_block + text[end:]

assert text != original
assert text.count("source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit')") == 6
assert text.count("source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit')") == 6
assert "source_service_type = 'merchant_cash_out_to_agent'" in text
assert text.count('CREATE POLICY company_transactions_perm_update') == 1
assert text.count('CREATE POLICY transactions_perm_insert') == 1
path.write_text(text, encoding='utf-8')
