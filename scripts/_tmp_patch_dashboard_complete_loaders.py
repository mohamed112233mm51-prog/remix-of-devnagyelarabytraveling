from pathlib import Path

path = Path('src/routes/index.tsx')
text = path.read_text(encoding='utf-8')

def replace_once(old: str, new: str):
    global text
    if old not in text:
        raise SystemExit(f'Expected snippet not found: {old[:140]!r}')
    text = text.replace(old, new, 1)

replace_once('import { supabase } from "@/integrations/supabase/client";\n', '')
replace_once('  type ExpenseDeduction,\n', '  type ExpenseDeduction,\n  type Execution,\n')
replace_once(
    'import { useExpensesTotals, computeTreasurySummary, computeTopAgentsByCollected, computeDashboardLifetime, useMerchantTotals, CurrencyMap } from "@/lib/financialSummary";\n',
    'import { summarizeExpenses, computeTreasurySummary, computeTopAgentsByCollected, computeDashboardLifetime, useMerchantTotals, CurrencyMap } from "@/lib/financialSummary";\n',
)

replacements = {
    '  const { rows: txns } = useLive<Transaction>("transactions");\n': '  const { rows: txns } = useCompleteFinancialTable<Transaction>("transactions");\n',
    '  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");\n': '  const { rows: cTxns } = useCompleteFinancialTable<CompanyTransaction>("company_transactions");\n',
    '  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");\n': '  const { rows: collections } = useCompleteFinancialTable<MerchantCashCollection>("merchant_cash_collections");\n',
    '  const { rows: collectionSplits } = useLive<{ id: string; source_table: string | null; source_id: string | null; currency: string | null; cancelled_at: string | null }>("payment_splits");\n': '  const { rows: collectionSplits } = useCompleteFinancialTable<{ id: string; source_table: string | null; source_id: string | null; currency: string | null; cancelled_at: string | null; created_at?: string | null }>("payment_splits");\n',
    '  const { rows: submissions } = useLive<Submission>("submissions");\n': '  const { rows: submissions } = useCompleteFinancialTable<Submission>("submissions");\n',
    '  const { rows: expenses } = useLive<Expense>("expenses");\n': '  const { rows: expenses } = useCompleteFinancialTable<Expense>("expenses");\n',
    '  const { rows: expenseDeductions } = useLive<ExpenseDeduction>("expense_deductions");\n': '  const { rows: expenseDeductions } = useCompleteFinancialTable<ExpenseDeduction>("expense_deductions");\n',
}
for old, new in replacements.items():
    replace_once(old, new)

replace_once(
'''  const executionMetricsQuery = useQuery({
    queryKey: ["dashboard-execution-metrics"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("executions")
        .select("id, created_at, operation_status, submission_id, services, destination")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; created_at: string | null; operation_status: string | null; submission_id: string | null; services: any; destination: string | null }[];
    },
  });
  const executionMetrics = executionMetricsQuery.data ?? [];
''',
'''  const { rows: executionMetrics } = useCompleteFinancialTable<Execution>("executions");
'''
)

replace_once(
'  const expensesTotals = useExpensesTotals();\n',
'  const expensesTotals = useMemo(() => summarizeExpenses(expenses), [expenses]);\n',
)

path.write_text(text, encoding='utf-8')
print('Dashboard large-table loaders migrated to complete paginated history.')
