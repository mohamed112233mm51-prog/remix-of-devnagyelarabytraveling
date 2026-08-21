# Trigger workflow after workflow file exists.
from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected snippet not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) The export/net summary must use the SAME accounting delta as cards/running balance.
replace_once(
    "src/lib/financialSummary.ts",
    '''export function summarizeCurrencySupplierNetByCurrency(\n  rows: CurrencySupplierTx[],\n): Array<{ currency: string; net: number }> {\n  const map = new Map<string, number>();\n  for (const t of buildCurrencySupplierLedgerRows(rows)) {\n    map.set(t.bought_currency, (map.get(t.bought_currency) || 0) + Number(t.bought_amount || 0));\n    map.set(t.sold_currency, (map.get(t.sold_currency) || 0) - Number(t.sold_amount || 0));\n  }\n  return Array.from(map.entries()).map(([currency, net]) => ({ currency, net }));\n}\n''',
    '''export function summarizeCurrencySupplierNetByCurrency(\n  rows: CurrencySupplierTx[],\n): Array<{ currency: string; net: number }> {\n  const map = new Map<string, number>();\n  for (const t of buildCurrencySupplierLedgerRows(rows)) {\n    const { currency, delta } = currencySupplierDelta(t);\n    map.set(currency, (map.get(currency) || 0) + delta);\n  }\n  const orderIndex = (currency: string) => {\n    const index = CURRENCY_ORDER.indexOf(currency);\n    return index >= 0 ? index : CURRENCY_ORDER.length;\n  };\n  return Array.from(map.entries())\n    .map(([currency, net]) => ({ currency, net }))\n    .filter(({ net }) => Math.abs(net) > 0.0001)\n    .sort((a, b) => orderIndex(a.currency) - orderIndex(b.currency) || a.currency.localeCompare(b.currency));\n}\n''',
)

# 2) Legacy statement must load the supplier ledger with pagination, not a capped select.
replace_once(
    "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx",
    'import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\n',
    'import { assertMerchantOutflowsAllowed } from "@/lib/merchantBalanceGuard";\nimport { fetchAllCurrencySupplierTransactions } from "@/lib/currencySupplierData";\n',
)
replace_once(
    "src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx",
    '''      const [{ data: sup }, { data: tx, error: txErr }, { data: bx }, { data: mer }] = await Promise.all([\n        supabase.from("currency_suppliers" as any).select("*").eq("id", supplierId).maybeSingle(),\n        supabase.from("currency_supplier_transactions" as any).select("*").eq("supplier_id", supplierId).order("tx_date", { ascending: true }),\n        supabase.from("cash_boxes" as any).select("*"),\n        supabase.from("merchants").select("*").eq("status", "نشط").order("merchant_name"),\n      ]);\n      if (cancel) return;\n      if (txErr) toast.error(txErr.message);\n      setSupplier((sup as any) || null);\n      setTxns(((tx as any) || []) as Tx[]);\n''',
    '''      const [{ data: sup }, tx, { data: bx }, { data: mer }] = await Promise.all([\n        supabase.from("currency_suppliers" as any).select("*").eq("id", supplierId).maybeSingle(),\n        fetchAllCurrencySupplierTransactions<Tx>(supplierId),\n        supabase.from("cash_boxes" as any).select("*"),\n        supabase.from("merchants").select("*").eq("status", "نشط").order("merchant_name"),\n      ]);\n      if (cancel) return;\n      setSupplier((sup as any) || null);\n      setTxns(tx);\n''',
)

# 3) Period cards must use the same complete ledger loader.
replace_once(
    "src/hooks/useCurrencySupplierPeriodTotals.ts",
    'import { supabase } from "@/integrations/supabase/client";\n',
    'import { supabase } from "@/integrations/supabase/client";\nimport { fetchAllCurrencySupplierTransactions } from "@/lib/currencySupplierData";\n',
)
replace_once(
    "src/hooks/useCurrencySupplierPeriodTotals.ts",
    '''    supabase\n      .from("currency_supplier_transactions" as any)\n      .select("*")\n      .eq("supplier_id", supplierId)\n      .order("tx_date", { ascending: true })\n      .then(({ data, error }) => {\n        if (cancelled) return;\n        if (error) {\n          console.error("[currency-supplier-period] load failed", error);\n          setRows([]);\n        } else {\n          setRows(((data as any) || []) as SupplierTransaction[]);\n        }\n        setLoading(false);\n      });\n''',
    '''    fetchAllCurrencySupplierTransactions<SupplierTransaction>(supplierId)\n      .then((data) => {\n        if (cancelled) return;\n        setRows(data);\n        setLoading(false);\n      })\n      .catch((error) => {\n        if (cancelled) return;\n        console.error("[currency-supplier-period] load failed", error);\n        setRows([]);\n        setLoading(false);\n      });\n''',
)

print("Patched currency supplier ledger consistency and complete-history loading.")
