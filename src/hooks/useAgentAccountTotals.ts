// Source of truth for the "Agent Accounts" aggregate cards.
// Used identically by:
//   - src/routes/accounts.tsx (page KPI boxes)
//   - src/routes/index.tsx    (dashboard section-details → الوكلاء)
//
// المصدر المحاسبي الوحيد:
//   - المدين     = نفس صفوف كشف حساب الوكيل (`buildAgentLedgerRows`).
//   - الدائن     = نفس صفوف كشف حساب الوكيل (`buildAgentLedgerRows`).
//   - المستحق    = المدين − الدائن لكل عملة على حدة.
//   - عدد الوكلاء = بطاقات الوكلاء الموجودة حالياً فقط.
//
// مهم: الإجماليات المالية لا تعتمد على بقاء بطاقة الوكيل. إذا حُذفت البطاقة
// وظلت حركات مالية تاريخية في transactions، تظل هذه الحركات داخلة في
// المدين/الدائن/الرصيد حتى لا يختفي التزام مالي بمجرد حذف كيان تشغيلي.

import { useMemo } from "react";
import { useLive, type Agent } from "@/lib/db";
import { CurrencyMap } from "@/lib/financialSummary";
import { useCompleteAgentsSummary } from "@/hooks/useCompleteAgentsSummary";

export type AgentAccountTotals = {
  agentCount: number;
  services: CurrencyMap;
  payments: CurrencyMap;
  due: CurrencyMap;
};

export function useAgentAccountTotals(): AgentAccountTotals {
  const summaries = useCompleteAgentsSummary();
  const { rows: agents } = useLive<Agent>("agents");

  return useMemo(() => {
    const services = new CurrencyMap();
    const payments = new CurrencyMap();
    const due = new CurrencyMap();

    for (const summary of summaries.values()) {
      services.merge(summary.totalDebit);
      payments.merge(summary.totalCredit);
      due.merge(summary.balance);
    }

    return {
      agentCount: agents.length,
      services,
      payments,
      due,
    };
  }, [summaries, agents.length]);
}
