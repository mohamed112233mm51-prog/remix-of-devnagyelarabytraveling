import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { CurrencyMap } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import { useCompleteAgentFinancialData } from "@/hooks/useCompleteAgentFinancialData";

export type AgentPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

/**
 * إجماليات فترة الوكلاء من نفس Agent Ledger النهائي المستخدم في الملخصات.
 * لا إعادة تفسير لـ transactions ولا بناء مستقل لخريطة العملات هنا.
 */
export function useAgentPeriodTotals(period: SummaryPeriod): AgentPeriodTotals {
  const { ledgerRows } = useCompleteAgentFinancialData();
  const todayISO = cairoToday();

  return useMemo(() => {
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
  }, [ledgerRows, period, todayISO]);
}
