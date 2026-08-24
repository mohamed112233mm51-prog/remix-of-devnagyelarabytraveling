import { useMemo } from "react";
import type { Transaction } from "@/lib/db";
import { buildAgentLedgerRows, resolveSplitCurrencyByRef } from "@/lib/financialSummary";
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
 * المصدر الكامل والموحد لحسابات الوكلاء.
 *
 * القاعدة المحاسبية هنا متعمدة:
 * 1) نحمّل التاريخ الكامل لـ transactions و payment_splits.
 * 2) نحدد عملة كل حركة من الـ splits النشطة بنفس resolver المركزي.
 * 3) نبني Agent Ledger مرة واحدة عبر buildAgentLedgerRows.
 *
 * أي كارت/تقرير/مركز مالي خاص بالوكلاء يجب أن يستهلك ledgerRows أو
 * البيانات المشتقة منه، بدل إعادة تفسير transactions بطريقته الخاصة.
 */
export function useCompleteAgentFinancialData() {
  const transactionsState = useCompleteFinancialTable<Transaction>("transactions");
  const paymentSplitsState = useCompleteFinancialTable<AgentPaymentSplitCurrencyRow>("payment_splits");

  const splitCurrencyByTxnId = useMemo(
    () => resolveSplitCurrencyByRef(paymentSplitsState.rows as any, "transactions"),
    [paymentSplitsState.rows],
  );

  const ledgerRows = useMemo(
    () => buildAgentLedgerRows(
      transactionsState.rows.filter((transaction) => Boolean(transaction?.agent_id)),
      splitCurrencyByTxnId,
    ),
    [transactionsState.rows, splitCurrencyByTxnId],
  );

  return {
    transactions: transactionsState.rows,
    paymentSplits: paymentSplitsState.rows,
    splitCurrencyByTxnId,
    ledgerRows,
    loading: transactionsState.loading || paymentSplitsState.loading,
    error: transactionsState.error || paymentSplitsState.error,
  };
}
