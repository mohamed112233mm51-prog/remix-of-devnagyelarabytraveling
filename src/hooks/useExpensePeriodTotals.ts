import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type Expense } from "@/lib/db";
import { summarizeExpenses } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

/** إجماليات عرض فقط؛ تستخدم نفس محرك المصروفات الحالي بعد فلترة التاريخ. */
export function useExpensePeriodTotals(period: SummaryPeriod) {
  const { rows: expenses } = useLive<Expense>("expenses");
  const todayISO = cairoToday();

  return useMemo(() => {
    const periodRows = expenses.filter((expense) =>
      isDateInSummaryPeriod(expense.date, period, todayISO),
    );
    return summarizeExpenses(periodRows);
  }, [expenses, period, todayISO]);
}
