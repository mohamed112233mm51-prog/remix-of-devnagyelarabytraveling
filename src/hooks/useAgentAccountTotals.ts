// Source of truth for the "Agent Accounts" aggregate cards.
// Used identically by:
//   - src/routes/accounts.tsx (page KPI boxes)
//   - src/routes/index.tsx    (dashboard section-details → الوكلاء)
//
// المصدر (نفسه في المكانين):
//   - الخدمات  = executions "منفذ" غير الملغاة، منسوبة لـ agent_id
//                (computeAgentServicesByCurrencyPerAgent → sumAgentCurrencyMaps)
//   - المدفوعات = transactions.agent_id غير الملغاة، عبر txnCollectedAmount
//                (computeAgentPaymentsByCurrencyPerAgent → sumAgentCurrencyMaps)
//   - المستحق  = subtractCurrencyMaps(الخدمات، المدفوعات) لكل عملة على حدة
//   - عدد الوكلاء = agents.length (نفس تعريف الصفحة قبل أي فلتر بحث)
//
// لا تحويل عملات، لا خلط، لا نطاق زمني (مدى الحياة — مثل صفحة الحسابات).

import { useMemo } from "react";
import { useLive, type Agent, type Execution, type Transaction } from "@/lib/db";
import { CurrencyMap } from "@/lib/financialSummary";
import {
  computeAgentServicesByCurrencyPerAgent,
  computeAgentPaymentsByCurrencyPerAgent,
  subtractCurrencyMaps,
  sumAgentCurrencyMaps,
} from "@/lib/dashboardCollections";

export type AgentAccountTotals = {
  agentCount: number;
  services: CurrencyMap;
  payments: CurrencyMap;
  due: CurrencyMap;
};

export function useAgentAccountTotals(): AgentAccountTotals {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: executions } = useLive<Execution>("executions");
  const { rows: txns } = useLive<Transaction>("transactions");

  return useMemo(() => {
    const servicesPerAgent = computeAgentServicesByCurrencyPerAgent(executions as any);
    const paymentsPerAgent = computeAgentPaymentsByCurrencyPerAgent(txns);
    const services = sumAgentCurrencyMaps(servicesPerAgent);
    const payments = sumAgentCurrencyMaps(paymentsPerAgent);
    const due = subtractCurrencyMaps(services, payments);
    return { agentCount: agents.length, services, payments, due };
  }, [agents, executions, txns]);
}
