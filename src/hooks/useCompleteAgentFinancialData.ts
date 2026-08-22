import type { Transaction } from "@/lib/db";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";

export type AgentPaymentSplitCurrencyRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  transaction_id?: string | null;
  currency: string | null;
  cancelled_at?: string | null;
  created_at?: string | null;
};

/**
 * المصدر الكامل الموحد لبيانات حسابات الوكلاء.
 *
 * أي كارت/كشف/تقرير أو مركز مالي يحتاج transactions + payment_splits
 * الخاصة بمنطق الوكلاء يجب أن يبدأ من هذا الـhook حتى لا يكون لكل شاشة
 * loader أو حد صفوف أو توقيت Realtime مختلف.
 */
export function useCompleteAgentFinancialData() {
  const transactionsState = useCompleteFinancialTable<Transaction>("transactions");
  const paymentSplitsState = useCompleteFinancialTable<AgentPaymentSplitCurrencyRow>("payment_splits");

  return {
    transactions: transactionsState.rows,
    paymentSplits: paymentSplitsState.rows,
    loading: transactionsState.loading || paymentSplitsState.loading,
    error: transactionsState.error || paymentSplitsState.error,
  };
}
