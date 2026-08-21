from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected snippet not found in {path}: {old[:120]!r}")
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")


# Investors page: use complete paginated history for investor transactions and payment splits.
replace_once(
    "src/routes/investors.tsx",
    'import { fmtCurrency, normalizeCurrency, refetchLiveTables, useLive, type Investor, type InvestorTransaction } from "@/lib/db";\n',
    'import { fmtCurrency, normalizeCurrency, refetchLiveTables, useLive, type Investor, type InvestorTransaction } from "@/lib/db";\nimport { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n',
)
replace_once(
    "src/routes/investors.tsx",
    '  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");\n  const { rows: paymentSplits } = useLive<FinancialPositionSplit>("payment_splits");\n',
    '  const { rows: txns } = useCompleteFinancialTable<InvestorTransaction>("investor_transactions");\n  const { rows: paymentSplits } = useCompleteFinancialTable<FinancialPositionSplit>("payment_splits");\n',
)

# Financial position: every potentially-growing source must be complete, not the implicit API row cap.
replace_once(
    "src/hooks/useFinancialPosition.ts",
    'import {\n  useLive,\n  type CompanyTransaction,\n',
    'import {\n  useLive,\n  type CompanyTransaction,\n',
)
replace_once(
    "src/hooks/useFinancialPosition.ts",
    '} from "@/lib/financialSummary";\n',
    '} from "@/lib/financialSummary";\nimport { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n',
)
replace_once(
    "src/hooks/useFinancialPosition.ts",
    '  const { rows: transactions } = useLive<Transaction>("transactions");\n  const { rows: companyTransactions } = useLive<CompanyTransaction>("company_transactions");\n  const { rows: merchantCollections } = useLive<MerchantCashCollection>("merchant_cash_collections");\n  const { rows: usdTreasuryRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");\n  const { rows: supplierTransactions } = useLive<any>("currency_supplier_transactions");\n  const { rows: investorTransactions } = useLive<InvestorTransaction>("investor_transactions");\n  const { rows: paymentSplits } = useLive<FinancialPositionSplit>("payment_splits");\n',
    '  const { rows: transactions } = useCompleteFinancialTable<Transaction>("transactions");\n  const { rows: companyTransactions } = useCompleteFinancialTable<CompanyTransaction>("company_transactions");\n  const { rows: merchantCollections } = useCompleteFinancialTable<MerchantCashCollection>("merchant_cash_collections");\n  const { rows: usdTreasuryRows } = useCompleteFinancialTable<UsdTreasuryTransaction>("usd_treasury_transactions");\n  const { rows: supplierTransactions } = useCompleteFinancialTable<any>("currency_supplier_transactions");\n  const { rows: investorTransactions } = useCompleteFinancialTable<InvestorTransaction>("investor_transactions");\n  const { rows: paymentSplits } = useCompleteFinancialTable<FinancialPositionSplit>("payment_splits");\n',
)

# Prevent a missing split caused by incomplete/temporarily unavailable split data from silently becoming EGP.
# Only genuinely legacy rows (no payment split rows anywhere in the complete dataset) use the legacy EGP fallback.
# The complete hook above is the guarantee that this distinction is based on full history.

print("Patched investors + financial position to use complete paginated financial history.")
