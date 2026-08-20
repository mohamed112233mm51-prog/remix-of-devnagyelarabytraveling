# PR trigger for applying the merchant complete-data fix.
# Retrigger after CI dependency-install correction.
from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly 1 match, found {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all_exact(path: str, old: str, new: str, expected: int):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")

# financialSummary: all merchant summary hooks must read the complete paginated source.
fs = "src/lib/financialSummary.ts"
replace_once(
    fs,
    'import { useMemo } from "react";\n',
    'import { useMemo } from "react";\nimport { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";\n',
)
old_block = '''  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: splits } = useLive<CollectionSplitRow>("payment_splits");'''
new_block = '''  const {
    transactions: txns,
    companyTransactions: companyTxns,
    collections,
    conversions: usdRows,
    paymentSplits: splits,
  } = useCompleteMerchantFinancialData();'''
replace_all_exact(fs, old_block, new_block, 3)

# Main merchant route: histories/statements must receive the same complete rows.
route = "src/features/merchants/LegacyMerchantsRoute.tsx"
replace_once(
    route,
    'import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";\n',
    'import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";\nimport { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";\n',
)
old_route = '''  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: paymentSplits } = useLive<{ id: string; source_table: string | null; source_id: string | null; currency: string | null; cancelled_at: string | null }>("payment_splits");'''
new_route = '''  const {
    transactions: txns,
    companyTransactions: cTxns,
    collections,
    conversions: usdRows,
    paymentSplits,
  } = useCompleteMerchantFinancialData();
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");'''
replace_once(route, old_route, new_route)

# Period cards: same complete source, so month/year totals cannot silently drop old rows.
period = "src/hooks/useMerchantPeriodTotals.ts"
replace_once(
    period,
    'import { useMemo } from "react";\n',
    'import { useMemo } from "react";\nimport { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";\n',
)
old_period = '''  const { rows: transactions } = useLive<Transaction>("transactions");
  const { rows: companyTransactions } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: conversions } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: paymentSplits } = useLive<CollectionSplitRow>("payment_splits");'''
new_period = '''  const {
    transactions,
    companyTransactions,
    collections,
    conversions,
    paymentSplits,
  } = useCompleteMerchantFinancialData();'''
replace_once(period, old_period, new_period)

# Remove no-longer-used useLive import from the period hook only.
p = Path(period)
text = p.read_text(encoding="utf-8")
text = text.replace('  useLive,\n', '')
p.write_text(text, encoding="utf-8")

print("merchant complete-data patch applied")
