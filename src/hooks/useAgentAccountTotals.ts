// Source of truth for the "Agent Accounts" aggregate cards.
// Used identically by:
//   - src/routes/accounts.tsx (page KPI boxes)
//   - src/routes/index.tsx    (dashboard section-details → الوكلاء)
//
// المصدر المحاسبي الوحيد:
//   - المدين     = نفس صفوف كشف حساب الوكيل (`buildAgentLedgerRows`).
//   - الدائن     = نفس صفوف كشف حساب الوكيل (`buildAgentLedgerRows`).
//   - المستحق    = المدين − الدائن لكل عملة على حدة.
//   - عدد الوكلاء = جميع الوكلاء الموجودين في جدول agents.
//
// بهذا الشكل، أي حركة قديمة أو رصيد افتتاحي أو حركة تنفيذ موجودة في دفتر
// transactions تظهر في القائمة والداشبورد والتقرير كما تظهر في كشف الحساب.
// لا تحويل عملات، لا خلط، ولا اعتماد على executions لحساب الرصيد.

import { useMemo } from "react";
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
      agentCount: summaries.size,
      services,
      payments,
      due,
    };
  }, [summaries]);
}
