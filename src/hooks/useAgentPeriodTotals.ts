import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { buildAgentLedgerRows, CurrencyMap, resolveSplitCurrencyByRef } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import { useCompleteAgentFinancialData } from "@/hooks/useCompleteAgentFinancialData";

export type AgentPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

/**
 * إجماليات الوكلاء للفترة من نفس مصدر البيانات الكامل ونفس Ledger المستخدم
 * في كشف الحساب والإجماليات العامة. لا يوجد Loader مستقل أو حد صفوف مختلف.
 */
export function useAgentPeriodTotals(period: SummaryPeriod): AgentPeriodTotals {
  const { transactions, paymentSplits } = useCompleteAgentFinancialData();
  const todayISO = cairoToday();

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveSplitCurrencyByRef(paymentSplits as any, "transactions");
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
