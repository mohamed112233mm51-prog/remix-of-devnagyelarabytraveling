import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";
import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive } from "@/lib/db";
import { computeExecutionAgentSalesByCurrency } from "@/lib/dashboardCollections";
import type { ExecutionRow } from "@/lib/executionProfit";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import type { CurrencyMap } from "@/lib/financialSummary";

type DashboardExecutionRow = ExecutionRow & {
  cancelled_at?: string | null;
};

/**
 * نفس معادلة «إجمالي مبيعات الوكلاء» الأصلية في الداشبورد:
 * مجموع agent_price × count من services الخاصة بالتنفيذات بحالة «منفذ» فقط،
 * مع إبقاء كل عملة منفصلة. الإضافة الوحيدة هي تطبيق فلتر الفترة الحالي.
 */
export function useExecutionAgentSalesPeriod(period: SummaryPeriod): CurrencyMap {
  const { rows: executions } = useCompleteFinancialTable<DashboardExecutionRow>("executions");
  const todayISO = cairoToday();

  return useMemo(() => {
    const executedInPeriod = executions.filter((execution) =>
      String(execution.operation_status || "").trim() === "منفذ"
      && !execution.cancelled_at
      && isDateInSummaryPeriod(execution.created_at || null, period, todayISO),
    );
    return computeExecutionAgentSalesByCurrency(executedInPeriod);
  }, [executions, period, todayISO]);
}
