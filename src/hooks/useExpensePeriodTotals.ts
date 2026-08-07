import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type Expense } from "@/lib/db";
import { summarizeExpenses } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

/**
 * إجماليات عرض فقط؛ تستخدم نفس محرك المصروفات الحالي بعد فلترة التاريخ.
 * تاريخ الحركة = date ثم created_at كـ fallback للسجلات القديمة.
 */
export function useExpensePeriodTotals(period: SummaryPeriod) {
  const { rows: expenses } = useLive<Expense>("expenses");
  const todayISO = cairoToday();

  return useMemo(() => {
    const periodRows = expenses.filter((expense) => {
      const accountingDate = expense.date || (expense as any).created_at || null;
      return isDateInSummaryPeriod(accountingDate, period, todayISO);
    });
    return summarizeExpenses(periodRows);
  }, [expenses, period, todayISO]);
}
