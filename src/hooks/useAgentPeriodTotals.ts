import { useEffect, useMemo, useState } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { supabase } from "@/integrations/supabase/client";
import { type Transaction } from "@/lib/db";
import { buildAgentLedgerRows, CurrencyMap } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import { toast } from "sonner";

type PaymentSplitCurrencyRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  transaction_id?: string | null;
  currency: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
};

export type AgentPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

const PAGE_SIZE = 1000;

async function loadAllRows<T>(table: "transactions" | "payment_splits"): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const page = Array.isArray(data) ? (data as T[]) : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

/**
 * نفس ربط العملة المستخدم في كشف الحساب، مع استبعاد سطور الدفع الملغاة.
 * هذا مهم بعد تعديل حركة أو إعادة تسجيلها بعملة مختلفة.
 */
function resolveActiveSplitCurrencyByRef(
  splits: readonly PaymentSplitCurrencyRow[],
  sourceTable: string,
): Map<string, string> {
  const buckets = new Map<string, Set<string>>();

  for (const split of splits) {
    if (!split || split.cancelled_at || split.source_table !== sourceTable) continue;
    const referenceId = split.source_id || split.transaction_id;
    const currency = String(split.currency || "").trim().toUpperCase();
    if (!referenceId || !currency) continue;

    const currencies = buckets.get(referenceId) || new Set<string>();
    currencies.add(currency);
    buckets.set(referenceId, currencies);
  }

  const result = new Map<string, string>();
  buckets.forEach((currencies, referenceId) => {
    if (currencies.size === 1) result.set(referenceId, Array.from(currencies)[0]);
  });
  return result;
}

/**
 * إجماليات عرض فقط من دفتر transactions نفسه.
 * يتم تحميل كل التاريخ على صفحات بدل الاعتماد على useLive العام المحدود بعدد الصفوف.
 * - تدخل كل حركة مرتبطة بوكيل، حتى لو تم حذف بطاقة الوكيل لاحقاً.
 * - الحركات الملغاة تُستبعد داخل buildAgentLedgerRows.
 * - تاريخ الفترة = date ثم created_at كـ fallback، مثل الداشبورد.
 * - العملات لا تُخلط.
 */
export function useAgentPeriodTotals(period: SummaryPeriod): AgentPeriodTotals {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitCurrencyRow[]>([]);
  const todayISO = cairoToday();

  useEffect(() => {
    let cancelled = false;

    const reload = async () => {
      try {
        const [allTransactions, allPaymentSplits] = await Promise.all([
          loadAllRows<Transaction>("transactions"),
          loadAllRows<PaymentSplitCurrencyRow>("payment_splits"),
        ]);

        if (!cancelled) {
          setTransactions(allTransactions);
          setPaymentSplits(allPaymentSplits);
        }
      } catch (error: any) {
        if (!cancelled) toast.error(error?.message || "تعذر تحميل إجماليات الوكلاء كاملة");
      }
    };

    reload();

    const txChannel = supabase
      .channel(`agent-period-totals-tx-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "transactions" }, reload)
      .subscribe();

    const splitChannel = supabase
      .channel(`agent-period-totals-splits-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "payment_splits" }, reload)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(txChannel);
      supabase.removeChannel(splitChannel);
    };
  }, []);

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveActiveSplitCurrencyByRef(paymentSplits, "transactions");
    const ledgerRows = buildAgentLedgerRows(
      transactions.filter((transaction) => Boolean(transaction?.agent_id)),
      splitCurrencyByTxnId,
    );

    const debit = new CurrencyMap();
    const credit = new CurrencyMap();
    const movement = new CurrencyMap();

    for (const row of ledgerRows) {
      const accountingDate = row.date || (row.raw as any)?.created_at || null;
      if (!isDateInSummaryPeriod(accountingDate, period, todayISO)) continue;
      debit.add(row.currency, row.debit);
      credit.add(row.currency, row.credit);
      movement.add(row.currency, row.debit - row.credit);
    }

    return { debit, credit, movement };
  }, [transactions, paymentSplits, period, todayISO]);
}
