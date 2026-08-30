import { useMemo } from "react";
import { useLive, type Agent } from "@/lib/db";
import { CurrencyMap, type EntitySummary } from "@/lib/financialSummary";
import { useCompleteAgentFinancialData } from "@/hooks/useCompleteAgentFinancialData";

function emptySummary(): EntitySummary {
  return {
    totalDebit: new CurrencyMap(),
    totalCredit: new CurrencyMap(),
    balance: new CurrencyMap(),
    count: 0,
  };
}

export function useCompleteAgentsSummary(): Map<string, EntitySummary> {
  const { rows: agents } = useLive<Agent>("agents");
  const { ledgerRows } = useCompleteAgentFinancialData();

  return useMemo(() => {
    const out = new Map<string, EntitySummary>();
    for (const agent of agents) out.set(agent.id, emptySummary());

    for (const row of ledgerRows) {
      const agentId = String((row.raw as any)?.agent_id || "").trim();
      if (!agentId) continue;

      let summary = out.get(agentId);
      if (!summary) {
        summary = emptySummary();
        out.set(agentId, summary);
      }

      summary.count += 1;
      summary.totalDebit.add(row.currency, row.debit);
      summary.totalCredit.add(row.currency, row.credit);
      summary.balance.add(row.currency, row.debit - row.credit);
    }

    return out;
  }, [agents, ledgerRows]);
}
