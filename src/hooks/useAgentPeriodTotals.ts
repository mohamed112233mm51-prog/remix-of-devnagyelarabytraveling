import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type Agent, type Transaction } from "@/lib/db";
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
 * إجماليات عرض فقط مبنية من نفس دفاتر كشف حساب الوكلاء الموجودين.
 * الحركات بلا وكيل أو التابعة لوكيل محذوف لا تدخل في كروت حسابات الوكلاء،
 * وهو نفس سلوك useAgentsSummary المستخدم في الصفحة الأصلية.
 */
export function useAgentPeriodTotals(period: SummaryPeriod): AgentPeriodTotals {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: transactions } = useLive<Transaction>("transactions");
  const { rows: paymentSplits } = useLive<PaymentSplitCurrencyRow>("payment_splits");
  const todayISO = cairoToday();

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveSplitCurrencyByRef(paymentSplits as any, "transactions");
    const transactionsByAgent = new Map<string, Transaction[]>();

    for (const agent of agents) transactionsByAgent.set(agent.id, []);
    for (const transaction of transactions) {
      const agentId = transaction.agent_id;
      if (!agentId) continue;
      const rows = transactionsByAgent.get(agentId);
      if (rows) rows.push(transaction);
    }

    const debit = new CurrencyMap();
    const credit = new CurrencyMap();
    const movement = new CurrencyMap();

    for (const agentTransactions of transactionsByAgent.values()) {
      const ledgerRows = buildAgentLedgerRows(agentTransactions, splitCurrencyByTxnId);
      for (const row of ledgerRows) {
        if (!isDateInSummaryPeriod(row.date, period, todayISO)) continue;
        debit.add(row.currency, row.debit);
        credit.add(row.currency, row.credit);
        movement.add(row.currency, row.debit - row.credit);
      }
    }

    return { debit, credit, movement };
  }, [agents, transactions, paymentSplits, period, todayISO]);
}
