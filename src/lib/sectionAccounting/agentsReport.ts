/**
 * Agents section — shared pure functions used by BOTH:
 *   - src/routes/accounts.tsx        (section KPI cards + per-agent table)
 *   - src/routes/reports.tsx         (AgentsReport — period-scoped view)
 *
 * الاعتماد الحصري:
 *   - `computeAgentServicesByCurrencyPerAgent` (executions "منفذ")
 *   - `computeAgentPaymentsByCurrencyPerAgent` (transactions.agent_id, txnCollectedAmount)
 * حتى يكون:
 *   إجمالي كروت التقرير عند "كل الوقت"  ==  إجمالي كروت صفحة حسابات الوكلاء.
 *
 * القاعدة: التقرير يضيف فقط طبقة inRange (تصفية زمنية) فوق نفس الدوال.
 */
import type { Agent, Execution, Transaction } from "@/lib/db";
import { CurrencyMap } from "@/lib/financialSummary";
import {
  computeAgentServicesByCurrencyPerAgent,
  computeAgentPaymentsByCurrencyPerAgent,
  subtractCurrencyMaps,
  sumAgentCurrencyMaps,
  rowAccountingDate,
  type DatePredicate,
} from "@/lib/dashboardCollections";

export type AgentReportRow = {
  id: string;
  name: string;
  services: CurrencyMap;
  payments: CurrencyMap;
  due: CurrencyMap;
  executions: number;
  approvals: number;
};

export type AgentReportSummaryV2 = {
  rows: AgentReportRow[];
  totals: {
    services: CurrencyMap;
    payments: CurrencyMap;
    due: CurrencyMap;
    executionsCount: number;
    approvalsCount: number;
  };
  filteredExecutions: Execution[];
  filteredTxns: Transaction[];
  filteredApprovals: any[];
};

/**
 * تاريخ اعتماد التنفيذ: `travel_date` ثم `created_at` كـ fallback.
 * (نفس القاعدة داخل computeAgentServicesByCurrencyPerAgent.)
 */
export function executionAccountingDate(
  ex: { travel_date?: string | null; created_at?: string | null } | null | undefined,
): string | null {
  if (!ex) return null;
  return (ex.travel_date && String(ex.travel_date)) ||
    (ex.created_at ? String(ex.created_at).slice(0, 10) : null);
}

function approvalDateOf(a: any): string | null {
  return (a?.submit_date && String(a.submit_date)) ||
    (a?.issue_date && String(a.issue_date)) ||
    (a?.created_at ? String(a.created_at).slice(0, 10) : null);
}

/**
 * الدالة النقية المشتركة لتقرير الوكلاء.
 * عند `predicate == null` النتيجة "مدى الحياة" وتطابق كروت صفحة الحسابات
 * حرفيًا لكل عملة (نفس المصدر ونفس دوال الجمع).
 */
export function computeAgentReport(input: {
  agents: Pick<Agent, "id" | "name">[];
  transactions: ReadonlyArray<Transaction>;
  executions: ReadonlyArray<Execution>;
  approvals?: ReadonlyArray<any>;
  predicate?: DatePredicate;
}): AgentReportSummaryV2 {
  const { agents, transactions, executions, approvals = [], predicate } = input;

  const servicesPerAgent = computeAgentServicesByCurrencyPerAgent(executions as any, predicate);
  const paymentsPerAgent = computeAgentPaymentsByCurrencyPerAgent(transactions, predicate);

  // Counts per agent (executions distinct per agent within the range).
  const execCountByAgent = new Map<string, number>();
  const filteredExecutions: Execution[] = [];
  for (const ex of executions) {
    if ((ex as any).cancelled_at) continue;
    if (((ex as any).operation_status || "") !== "منفذ") continue;
    const d = executionAccountingDate(ex as any);
    if (predicate && !predicate(d)) continue;
    filteredExecutions.push(ex);
    const seen = new Set<string>();
    if ((ex as any).agent_id) seen.add(String((ex as any).agent_id));
    const services = Array.isArray((ex as any).services) ? (ex as any).services : [];
    for (const s of services) {
      const aid = s && (s.agent_id ?? s.agentId);
      if (aid) seen.add(String(aid));
    }
    for (const aid of seen) execCountByAgent.set(aid, (execCountByAgent.get(aid) || 0) + 1);
  }

  const filteredTxns: Transaction[] = [];
  for (const t of transactions) {
    if ((t as any).cancelled_at) continue;
    if (predicate && !predicate(rowAccountingDate(t as any))) continue;
    filteredTxns.push(t);
  }

  const filteredApprovals: any[] = [];
  const approvalCountByAgent = new Map<string, number>();
  for (const a of approvals) {
    if (predicate && !predicate(approvalDateOf(a))) continue;
    filteredApprovals.push(a);
    const aid = (a as any).agent_id;
    if (aid) approvalCountByAgent.set(String(aid), (approvalCountByAgent.get(String(aid)) || 0) + 1);
  }

  const rows: AgentReportRow[] = agents.map((a) => {
    const services = servicesPerAgent.get(a.id) || new CurrencyMap();
    const payments = paymentsPerAgent.get(a.id) || new CurrencyMap();
    const due = subtractCurrencyMaps(services, payments);
    return {
      id: a.id,
      name: a.name,
      services,
      payments,
      due,
      executions: execCountByAgent.get(a.id) || 0,
      approvals: approvalCountByAgent.get(a.id) || 0,
    };
  });

  return {
    rows,
    totals: {
      services: sumAgentCurrencyMaps(servicesPerAgent),
      payments: sumAgentCurrencyMaps(paymentsPerAgent),
      due: subtractCurrencyMaps(
        sumAgentCurrencyMaps(servicesPerAgent),
        sumAgentCurrencyMaps(paymentsPerAgent),
      ),
      executionsCount: filteredExecutions.length,
      approvalsCount: filteredApprovals.length,
    },
    filteredExecutions,
    filteredTxns,
    filteredApprovals,
  };
}
