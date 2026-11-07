import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";
import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import type { Expense } from "@/lib/db";
import { summarizeExpenses } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import { expenseAccountingDay } from "@/lib/expenseArchive";

/**
 * إجماليات عرض فقط؛ تستخدم نفس محرك المصروفات الحالي بعد فلترة التاريخ.
 * تاريخ الحركة = date ثم created_at كـ fallback للسجلات القديمة.
 */
export function useExpensePeriodTotals(period: SummaryPeriod) {
  const { rows: expenses } = useCompleteFinancialTable<Expense>("expenses");
  const todayISO = cairoToday();

  return useMemo(() => {
    const periodRows = expenses.filter((expense) => {
      const accountingDate = expenseAccountingDay(expense);
      return isDateInSummaryPeriod(accountingDate, period, todayISO);
    });
    return summarizeExpenses(periodRows);
  }, [expenses, period, todayISO]);
}
