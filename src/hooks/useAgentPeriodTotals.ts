import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type Transaction } from "@/lib/db";
import { buildAgentLedgerRows, CurrencyMap } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

type PaymentSplitCurrencyRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  transaction_id?: string | null;
  currency: string | null;
  cancelled_at?: string | null;
};

export type AgentPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

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
 * - تدخل كل حركة مرتبطة بوكيل، حتى لو تم حذف بطاقة الوكيل لاحقاً.
 * - الحركات الملغاة تُستبعد داخل buildAgentLedgerRows.
 * - تاريخ الفترة = date ثم created_at كـ fallback، مثل الداشبورد.
 * - العملات لا تُخلط.
 */
export function useAgentPeriodTotals(period: SummaryPeriod): AgentPeriodTotals {
  const { rows: transactions } = useLive<Transaction>("transactions");
  const { rows: paymentSplits } = useLive<PaymentSplitCurrencyRow>("payment_splits");
  const todayISO = cairoToday();

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
