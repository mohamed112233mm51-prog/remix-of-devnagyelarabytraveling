import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type Transaction } from "@/lib/db";
import {
  buildAgentLedgerRows,
  CurrencyMap,
  resolveSplitCurrencyByRef,
} from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

type PaymentSplitCurrencyRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at?: string | null;
};

export type AgentPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

/**
 * إجماليات عرض فقط مبنية من نفس صفوف كشف حساب الوكيل.
 * لا تنشئ أو تعدل أي حركة، ولا تغيّر الرصيد التراكمي داخل الكشف.
 */
export function useAgentPeriodTotals(period: SummaryPeriod): AgentPeriodTotals {
  const { rows: transactions } = useLive<Transaction>("transactions");
  const { rows: paymentSplits } = useLive<PaymentSplitCurrencyRow>("payment_splits");
  const todayISO = cairoToday();

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveSplitCurrencyByRef(paymentSplits as any, "transactions");
    const ledgerRows = buildAgentLedgerRows(transactions, splitCurrencyByTxnId);
    const debit = new CurrencyMap();
    const credit = new CurrencyMap();
    const movement = new CurrencyMap();

    for (const row of ledgerRows) {
      if (!isDateInSummaryPeriod(row.date, period, todayISO)) continue;
      debit.add(row.currency, row.debit);
      credit.add(row.currency, row.credit);
      movement.add(row.currency, row.debit - row.credit);
    }

    return { debit, credit, movement };
  }, [transactions, paymentSplits, period, todayISO]);
}
