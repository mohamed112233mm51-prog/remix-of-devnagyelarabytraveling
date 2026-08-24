from pathlib import Path

path = Path('src/lib/financialSummary.ts')
text = path.read_text(encoding='utf-8')

repls = [
    (
        'import { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";\n',
        'import { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";\nimport { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n',
    ),
    (
        '  const { rows } = useLive<Transaction>("transactions");\n  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");',
        '  const { rows } = useCompleteFinancialTable<Transaction>("transactions");\n  const { rows: splits } = useCompleteFinancialTable<SplitCurrencyRow>("payment_splits");',
    ),
    (
        '  const { rows: txns } = useLive<Transaction>("transactions");\n  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");',
        '  const { rows: txns } = useCompleteFinancialTable<Transaction>("transactions");\n  const { rows: splits } = useCompleteFinancialTable<SplitCurrencyRow>("payment_splits");',
    ),
    (
        '  const { rows } = useLive<CompanyTransaction>("company_transactions");\n  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");',
        '  const { rows } = useCompleteFinancialTable<CompanyTransaction>("company_transactions");\n  const { rows: splits } = useCompleteFinancialTable<SplitCurrencyRow>("payment_splits");',
    ),
    (
        '  const { rows: txns } = useLive<CompanyTransaction>("company_transactions");\n  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");',
        '  const { rows: txns } = useCompleteFinancialTable<CompanyTransaction>("company_transactions");\n  const { rows: splits } = useCompleteFinancialTable<SplitCurrencyRow>("payment_splits");',
    ),
    (
        '  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");',
        '  const { rows: txns } = useCompleteFinancialTable<InvestorTransaction>("investor_transactions");',
    ),
    (
        '  const { rows } = useLive<Expense>("expenses");',
        '  const { rows } = useCompleteFinancialTable<Expense>("expenses");',
    ),
]

for old, new in repls:
    count = text.count(old)
    if count == 0:
        raise SystemExit(f'Expected pattern not found:\n{old}')
    text = text.replace(old, new)

path.write_text(text, encoding='utf-8')
print('financialSummary large-table hooks migrated to complete paginated history')
