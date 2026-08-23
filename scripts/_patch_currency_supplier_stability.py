from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:80]!r}')
    p.write_text(text.replace(old, new, 1))

# Dashboard: full financial history instead of useLive cap.
replace_once(
    'src/routes/index.tsx',
    'import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";\n',
    'import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";\nimport { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n',
)
replace_once(
    'src/routes/index.tsx',
    '  const { rows: currencyTxns } = useLive<{ id: string; supplier_id: string | null; tx_type: string | null; bought_currency: string | null; sold_currency: string | null; bought_amount: number | null; sold_amount: number | null; exchange_rate: number | null; tx_date: string; created_at: string; payment_splits: any }>("currency_supplier_transactions");\n',
    '  const { rows: currencyTxns } = useCompleteFinancialTable<{ id: string; supplier_id: string | null; tx_type: string | null; bought_currency: string | null; sold_currency: string | null; bought_amount: number | null; sold_amount: number | null; exchange_rate: number | null; tx_date: string; created_at: string; payment_splits: any; opening_currency?: string | null; cancelled_at?: string | null }>("currency_supplier_transactions");\n',
)

# Reports: full supplier history too.
replace_once(
    'src/routes/reports.tsx',
    'import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";\n',
    'import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";\nimport { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";\n',
)
replace_once(
    'src/routes/reports.tsx',
    '  const { rows: txns, loading } = useLive<CurrencySupplierTx>("currency_supplier_transactions" as any);\n',
    '  const { rows: txns, loading } = useCompleteFinancialTable<CurrencySupplierTx>("currency_supplier_transactions");\n',
)

# Dashboard supplier due: same ledger/delta as supplier statement.
replace_once(
    'src/lib/dashboardCollections.ts',
    'import { CurrencyMap } from "@/lib/financialSummary";\n',
    'import { CurrencyMap, buildCurrencySupplierLedgerRows, currencySupplierDelta } from "@/lib/financialSummary";\n',
)
old = '''export function computeCurrencySupplierStatsByCurrency(\n  txns: ReadonlyArray<CurrencyTxnLike>,\n  activeSupplierIds: ReadonlySet<string>,\n): { purchases: CurrencyMap; payments: CurrencyMap; due: CurrencyMap } {\n  const purchases = new CurrencyMap();\n  const payments = new CurrencyMap();\n  for (const t of txns) {\n    if (t.cancelled_at) continue;\n    if (!t.supplier_id || !activeSupplierIds.has(t.supplier_id)) continue;\n    if ((t.tx_type || "") !== "شراء عملة") continue;\n    const owedCur = normalizeCurrency(t.sold_currency);\n    const owedAmt = Number(t.sold_amount || 0);\n    if (owedAmt) purchases.add(owedCur, owedAmt);\n    const splits = Array.isArray(t.payment_splits) ? t.payment_splits : [];\n    for (const s of splits) {\n      const amt = Number((s && s.amount) || 0);\n      if (!amt) continue;\n      const cur = normalizeCurrency((s && s.currency) ?? owedCur);\n      payments.add(cur, amt);\n    }\n  }\n  return { purchases, payments, due: subtractCurrencyMaps(purchases, payments) };\n}\n'''
new = '''export function computeCurrencySupplierStatsByCurrency(\n  txns: ReadonlyArray<CurrencyTxnLike>,\n  activeSupplierIds: ReadonlySet<string>,\n): { purchases: CurrencyMap; payments: CurrencyMap; due: CurrencyMap } {\n  const purchases = new CurrencyMap();\n  const payments = new CurrencyMap();\n  const activeRows = txns.filter((t) => t.supplier_id && activeSupplierIds.has(t.supplier_id));\n  const ledgerRows = buildCurrencySupplierLedgerRows(activeRows as any);\n\n  // Display metrics remain purchase/payment totals.\n  for (const t of ledgerRows) {\n    if ((t.tx_type || "") !== "شراء عملة") continue;\n    const owedCur = normalizeCurrency(t.sold_currency);\n    const owedAmt = Number(t.sold_amount || 0);\n    if (owedAmt) purchases.add(owedCur, owedAmt);\n    const splits = Array.isArray(t.payment_splits) ? t.payment_splits : [];\n    for (const s of splits) {\n      const amt = Number((s && s.amount) || 0);\n      if (!amt) continue;\n      payments.add(normalizeCurrency(((s as any)?.currency) ?? owedCur), amt);\n    }\n  }\n\n  // The due balance is the exact supplier ledger balance, not a second formula.\n  const due = new CurrencyMap();\n  for (const t of ledgerRows) {\n    const { currency, delta } = currencySupplierDelta(t as any);\n    due.add(currency, delta);\n  }\n  return { purchases, payments, due };\n}\n'''
replace_once('src/lib/dashboardCollections.ts', old, new)

# temporary CI final rerun
