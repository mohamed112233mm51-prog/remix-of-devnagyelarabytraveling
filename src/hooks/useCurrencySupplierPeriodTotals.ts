import { useEffect, useMemo, useState } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { normalizeCurrency } from "@/lib/db";
import {
  buildCurrencySupplierLedgerRows,
  summarizeCurrencySupplierStatement,
} from "@/lib/financialSummary";
import { supabase } from "@/integrations/supabase/client";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import type { CurrencyTotal } from "@/components/CurrencyTotalsCards";

type SupplierTransaction = {
  id: string;
  supplier_id: string;
  tx_date: string;
  tx_type: string;
  bought_currency: string;
  bought_amount: number | string | null;
  sold_currency: string;
  sold_amount: number | string | null;
  exchange_rate?: number | null;
  payment_splits?: unknown;
  opening_currency?: string | null;
  created_at?: string | null;
  cancelled_at?: string | null;
};

/**
 * كروت عرض فقط من نفس دفتر كشف مورد العملة.
 * الفلترة على tx_date ولا يتم تعديل أي صف في قاعدة البيانات.
 */
export function useCurrencySupplierPeriodTotals(
  supplierId: string,
  period: SummaryPeriod,
): { totals: CurrencyTotal[]; loading: boolean } {
  const [rows, setRows] = useState<SupplierTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const todayISO = cairoToday();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("currency_supplier_transactions" as any)
      .select("*")
      .eq("supplier_id", supplierId)
      .order("tx_date", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[currency-supplier-period] load failed", error);
          setRows([]);
        } else {
          setRows(((data as any) || []) as SupplierTransaction[]);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [supplierId, reload]);

  useEffect(() => {
    const channel = supabase
      .channel(`currency-supplier-period-${supplierId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "currency_supplier_transactions",
        filter: `supplier_id=eq.${supplierId}`,
      }, () => setReload((value) => value + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supplierId]);

  const totals = useMemo(() => {
    const normalized = rows.map((row) => ({
      ...row,
      bought_currency: normalizeCurrency(row.bought_currency),
      sold_currency: normalizeCurrency(row.sold_currency),
      opening_currency: row.opening_currency
        ? normalizeCurrency(row.opening_currency)
        : row.opening_currency,
    }));
    const ledgerRows = buildCurrencySupplierLedgerRows(normalized as any);
    const periodRows = ledgerRows.filter((row) =>
      isDateInSummaryPeriod((row as any).tx_date, period, todayISO),
    );
    return summarizeCurrencySupplierStatement(periodRows as any);
  }, [rows, period, todayISO]);

  return { totals, loading };
}
