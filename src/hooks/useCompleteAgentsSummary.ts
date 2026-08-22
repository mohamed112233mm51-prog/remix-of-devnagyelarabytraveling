import { useMemo } from "react";
import { useLive, type Agent, type Transaction } from "@/lib/db";
import { resolveSplitCurrencyByRef, summarizeAgent, type EntitySummary } from "@/lib/financialSummary";
import { useCompleteAgentFinancialData } from "@/hooks/useCompleteAgentFinancialData";

export function useCompleteAgentsSummary(): Map<string, EntitySummary> {
  const { rows: agents } = useLive<Agent>("agents");
  const { transactions: txns, paymentSplits: splits } = useCompleteAgentFinancialData();

  return useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    for (const a of agents) grouped.set(a.id, []);
    for (const t of txns) {
      if (!t.agent_id) continue;
      const list = grouped.get(t.agent_id);
      if (list) list.push(t);
    }

    const curMap = resolveSplitCurrencyByRef(splits as any, "transactions");
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeAgent(list, curMap));
    return out;
  }, [agents, txns, splits]);
}
