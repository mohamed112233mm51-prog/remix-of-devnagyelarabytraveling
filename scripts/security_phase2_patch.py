from pathlib import Path
import re

path = Path('supabase/migrations/20260810200500_permission_aware_business_rls.sql')
text = path.read_text(encoding='utf-8')
original = text

# Make payment_split authorization parent-aware for transaction/company sources.
pattern = re.compile(
    r"CREATE OR REPLACE FUNCTION public\.app_payment_split_write_allowed\(.*?GRANT EXECUTE ON FUNCTION public\.app_payment_split_write_allowed\(text, text\) TO authenticated, service_role;",
    re.S,
)
replacement = r'''CREATE OR REPLACE FUNCTION public.app_payment_split_write_allowed(
  p_source_table text,
  p_source_id uuid,
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
      EXISTS (
        SELECT 1
        FROM public.transactions t
        WHERE t.id = p_source_id
          AND CASE WHEN p_action = 'create' THEN (
            (t.agent_id IS NOT NULL AND public.app_permission_allowed('accounts', 'create'))
            OR (t.agent_id IS NULL AND t.merchant_id IS NOT NULL AND public.app_permission_allowed('merchants', 'create'))
            OR (t.source_service_type = 'merchant_cash_out_to_company' AND public.app_permission_allowed('companies', 'create'))
            OR (t.source_service_type = 'merchant_cash_out_to_agent' AND public.app_permission_allowed('accounts', 'create'))
            OR (t.source_service_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
            OR (t.source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
            OR (t.source_service_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
            OR (t.source_service_type IN ('flight_ticket','security_approval','libyan_investment')
                AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'))
          ) ELSE (
            public.app_financial_action_allowed('accounts', p_action)
            OR (t.agent_id IS NULL AND t.merchant_id IS NOT NULL AND public.app_financial_action_allowed('merchants', p_action))
            OR (t.source_service_type = 'merchant_cash_out_to_company' AND public.app_financial_action_allowed('companies', p_action))
            OR (t.source_service_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
            OR (t.source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
            OR (t.source_service_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
            OR (t.source_service_type IN ('flight_ticket','security_approval','libyan_investment')
                AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'))
          ) END
      )
    WHEN 'company_transactions' THEN
      EXISTS (
        SELECT 1
        FROM public.company_transactions ct
        WHERE ct.id = p_source_id
          AND CASE WHEN p_action = 'create' THEN (
            public.app_permission_allowed('companies', 'create')
            OR (ct.source_service_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
            OR (ct.source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
            OR (ct.source_service_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
            OR (ct.source_service_type IN ('flight_ticket','security_approval','libyan_investment')
                AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'))
          ) ELSE (
            public.app_financial_action_allowed('companies', p_action)
            OR (ct.source_service_type = 'execution' AND public.app_permission_allowed('executions', 'edit'))
            OR (ct.source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions', 'edit'))
            OR (ct.source_service_type = 'execution_fine' AND public.app_permission_allowed('executions', 'edit'))
            OR (ct.source_service_type IN ('flight_ticket','security_approval','libyan_investment')
                AND public.app_has_any_permission(ARRAY['submissions','executions'], 'edit'))
          ) END
      )
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
        THEN public.app_permission_allowed('reports', 'edit') OR public.app_permission_allowed('companies', 'create')
        ELSE public.app_financial_action_allowed('reports', p_action)
      END
    WHEN 'cash_transfers' THEN
      public.app_permission_allowed('reports', CASE WHEN p_action = 'delete' THEN 'delete' ELSE 'edit' END)
    WHEN 'cash_box_transfer' THEN
      public.app_permission_allowed('reports', CASE WHEN p_action = 'delete' THEN 'delete' ELSE 'edit' END)
    ELSE
      CASE
        WHEN p_action = 'edit'
          THEN public.app_permission_allowed('financial_transaction_update', 'edit')
        WHEN p_action = 'delete'
          THEN public.app_permission_allowed('financial_cancel', 'delete')
        ELSE false
      END
  END;
$$;

REVOKE ALL ON FUNCTION public.app_payment_split_write_allowed(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_payment_split_write_allowed(text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_payment_split_write_allowed(text, uuid, text) TO authenticated, service_role;'''
text, count = pattern.subn(replacement, text, count=1)
assert count == 1, f'payment split helper block replacement count={count}'

# Cross-section reads required by legitimate side-effect flows.
text = text.replace(
    "ARRAY['accounts','merchants','reports','dashboard','financial_position_view']",
    "ARRAY['accounts','companies','merchants','submissions','executions','reports','dashboard','financial_position_view']",
    1,
)
text = text.replace(
    "ARRAY['companies','reports','dashboard','financial_position_view']",
    "ARRAY['companies','submissions','executions','reports','dashboard','financial_position_view']",
    1,
)
text = text.replace(
    "ARRAY['merchants','accounts','currency_suppliers','reports','dashboard','financial_position_view']",
    "ARRAY['merchants','accounts','currency_suppliers','expenses','reports','dashboard','financial_position_view']",
    1,
)

# Transactions: allow only the known generated source types for their owning workflow.
needle = """  OR (\n    source_service_type = 'execution'\n    AND public.app_permission_allowed('executions','edit')\n    AND EXISTS (\n      SELECT 1 FROM public.executions e\n      WHERE e.id::text = split_part(COALESCE(source_service_id,''), '::', 1)\n    )\n  )\n"""
extra = needle + """  OR (source_service_type = 'merchant_cash_out_to_company' AND agent_id IS NULL AND merchant_id IS NOT NULL AND public.app_permission_allowed('companies','create'))\n  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))\n  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type IN ('flight_ticket','security_approval','libyan_investment') AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit'))\n"""
assert text.count(needle) >= 1
text = text.replace(needle, extra, 1)

# Add generated-source allowances to transaction update/check/delete blocks.
for marker in [
    "  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))\n",
]:
    # first two occurrences are UPDATE USING/WITH CHECK, third is DELETE
    addition = marker + "  OR (source_service_type = 'merchant_cash_out_to_company' AND public.app_financial_action_allowed('companies','edit'))\n  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))\n  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type IN ('flight_ticket','security_approval','libyan_investment') AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit'))\n"
    text = text.replace(marker, addition, 2)
# DELETE uses delete semantics for company counterpart plus workflow edit for generated rows.
delete_marker = "  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('accounts','edit'))\n"
delete_add = "  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type = 'merchant_cash_out_to_company' AND public.app_financial_action_allowed('companies','delete'))\n  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))\n  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type IN ('flight_ticket','security_approval','libyan_investment') AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit'))\n  OR (source_service_type IN ('opening_debit','opening_credit') AND public.app_permission_allowed('accounts','edit'))\n"
text = text.replace(delete_marker, delete_add, 1)

# Company generated service/fine rows.
company_exec_insert = """  OR (\n    source_service_type = 'execution'\n    AND public.app_permission_allowed('executions','edit')\n    AND EXISTS (\n      SELECT 1 FROM public.executions e\n      WHERE e.id::text = split_part(COALESCE(source_service_id,''), '::', 1)\n    )\n  )\n"""
company_extra = company_exec_insert + """  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))\n  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type IN ('flight_ticket','security_approval','libyan_investment') AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit'))\n"""
text = text.replace(company_exec_insert, company_extra, 1)
company_marker = "  OR (source_service_type = 'execution' AND public.app_permission_allowed('executions','edit'))\n"
company_add = company_marker + "  OR (source_service_type = 'submission_fine' AND public.app_permission_allowed('submissions','edit'))\n  OR (source_service_type = 'execution_fine' AND public.app_permission_allowed('executions','edit'))\n  OR (source_service_type IN ('flight_ticket','security_approval','libyan_investment') AND public.app_has_any_permission(ARRAY['submissions','executions'],'edit'))\n"
# after previous replacements, target the company section occurrences by splitting around policy name
before_company, sep, after_company = text.partition('CREATE POLICY company_transactions_perm_update')
assert sep
# update USING + WITH CHECK + delete execution marker in after_company
for _ in range(3):
    if company_marker in after_company:
        after_company = after_company.replace(company_marker, company_add, 1)
text = before_company + sep + after_company

# Merchant side-effects created/deleted by the expenses workflow.
text = text.replace(
    "  OR public.app_permission_allowed('currency_suppliers','create')\n  OR (source_service_type IN ('opening_debit','opening_credit')",
    "  OR public.app_permission_allowed('currency_suppliers','create')\n  OR (expense_id IS NOT NULL AND public.app_permission_allowed('expenses','create'))\n  OR (source_service_type IN ('opening_debit','opening_credit')",
    1,
)
text = text.replace(
    "  public.app_financial_action_allowed('merchants','delete')\n  OR (source_service_type IN ('opening_debit','opening_credit')",
    "  public.app_financial_action_allowed('merchants','delete')\n  OR (expense_id IS NOT NULL AND public.app_permission_allowed('expenses','delete'))\n  OR (source_service_type IN ('opening_debit','opening_credit')",
    1,
)

# Legacy USD conversion lives inside the companies workflow.
text = text.replace(
    "ARRAY['reports','dashboard']",
    "ARRAY['reports','companies','dashboard']",
    1,
)
text = text.replace(
    "FOR INSERT TO authenticated WITH CHECK (public.app_permission_allowed('reports','edit'));",
    "FOR INSERT TO authenticated WITH CHECK (\n  public.app_permission_allowed('reports','edit')\n  OR (type = 'conversion' AND public.app_permission_allowed('companies','create'))\n);",
    1,
)

# Policies now pass source_id into the source-aware helper.
text = text.replace("public.app_payment_split_write_allowed(source_table, 'create')", "public.app_payment_split_write_allowed(source_table, source_id, 'create')")
text = text.replace("public.app_payment_split_write_allowed(source_table, 'edit')", "public.app_payment_split_write_allowed(source_table, source_id, 'edit')")
text = text.replace("public.app_payment_split_write_allowed(source_table, 'delete')", "public.app_payment_split_write_allowed(source_table, source_id, 'delete')")

# Guardrails.
assert text != original
assert 'app_payment_split_write_allowed(text, uuid, text)' in text
assert "expense_id IS NOT NULL AND public.app_permission_allowed('expenses','create')" in text
assert "type = 'conversion' AND public.app_permission_allowed('companies','create')" in text
assert "merchant_cash_out_to_company" in text
assert "submission_fine" in text and "execution_fine" in text
assert "app_payment_split_write_allowed(source_table, source_id, 'create')" in text
path.write_text(text, encoding='utf-8')

# Align treasury action UI with the new reports.edit database permission.
reports_path = Path('src/routes/reports.tsx')
reports = reports_path.read_text(encoding='utf-8')
reports_original = reports
if 'import { usePerm } from "@/hooks/usePerm";' not in reports:
    reports = reports.replace('import { createFileRoute } from "@tanstack/react-router";\n', 'import { createFileRoute } from "@tanstack/react-router";\nimport { usePerm } from "@/hooks/usePerm";\n', 1)
reports = reports.replace(
    'function TreasuriesReport({ inRange }: { inRange: (d: string | null | undefined) => boolean }) {\n',
    'function TreasuriesReport({ inRange }: { inRange: (d: string | null | undefined) => boolean }) {\n  const reportPerm = usePerm("reports");\n',
    1,
)
reports = reports.replace(
    '<button type="button" className="btn btn-gold" onClick={() => setTransferOpen(true)} disabled={active.length < 2}>\n          ⇄ تحويل بين الخزائن\n        </button>',
    '{reportPerm.edit && (\n          <button type="button" className="btn btn-gold" onClick={() => setTransferOpen(true)} disabled={active.length < 2}>\n            ⇄ تحويل بين الخزائن\n          </button>\n        )}',
    1,
)
reports = reports.replace(
    '<button type="button" className="action-btn" onClick={() => setEditBox(b)}>رصيد افتتاحي</button>\n                    <button type="button" className="action-btn" style={{ marginInlineStart: 6 }} onClick={() => setReconcileBox(b)}>⚖️ تسوية الخزنة</button>',
    '{reportPerm.edit ? (<>\n                      <button type="button" className="action-btn" onClick={() => setEditBox(b)}>رصيد افتتاحي</button>\n                      <button type="button" className="action-btn" style={{ marginInlineStart: 6 }} onClick={() => setReconcileBox(b)}>⚖️ تسوية الخزنة</button>\n                    </>) : "—"}',
    1,
)
assert reports != reports_original
assert 'const reportPerm = usePerm("reports");' in reports
assert '{reportPerm.edit && (' in reports
reports_path.write_text(reports, encoding='utf-8')
