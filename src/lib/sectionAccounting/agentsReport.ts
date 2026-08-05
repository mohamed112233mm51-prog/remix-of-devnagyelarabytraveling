/**
 * Agents section — shared pure functions used by reports.
 *
 * المصدر المالي الوحيد هو نفس دفتر كشف حساب الوكيل:
 * `buildAgentLedgerRows(transactions)`.
 *
 * التنفيذات تُستخدم فقط للعدادات التشغيلية (عدد التنفيذات)، وليست مصدرًا
 * لحساب المدين أو الدائن أو الرصيد.
 */
import type { Agent, Execution, Transaction } from "@/lib/db";
import {
  CurrencyMap,
  buildAgentLedgerRows,
  resolveSplitCurrencyByRef,
} from "@/lib/financialSummary";
import {
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

type PaymentSplitLite = {
  source_table?: string | null;
  source_id?: string | null;
  transaction_id?: string | null;
  currency?: string | null;
};

/** التاريخ التشغيلي لعدّ التنفيذات داخل الفترة فقط. */
export function executionAccountingDate(
  ex: {
    financial_posting_date?: string | null;
    created_at?: string | null;
  } | null | undefined,
): string | null {
  if (!ex) return null;
  return (ex.financial_posting_date && String(ex.financial_posting_date).slice(0, 10)) ||
    (ex.created_at ? String(ex.created_at).slice(0, 10) : null);
}

function approvalDateOf(a: any): string | null {
  return (a?.submit_date && String(a.submit_date)) ||
    (a?.issue_date && String(a.issue_date)) ||
    (a?.created_at ? String(a.created_at).slice(0, 10) : null);
}

function addMap(target: CurrencyMap, source: CurrencyMap): void {
  target.merge(source);
}

/**
 * عند عدم وجود predicate تكون النتيجة مدى الحياة، ويجب أن تطابق كشف الحساب
 * وكروت صفحة حسابات الوكلاء حرفيًا لكل عملة.
 */
export function computeAgentReport(input: {
  agents: Pick<Agent, "id" | "name">[];
  transactions: ReadonlyArray<Transaction>;
  executions: ReadonlyArray<Execution>;
  approvals?: ReadonlyArray<any>;
  paymentSplits?: ReadonlyArray<PaymentSplitLite>;
  predicate?: DatePredicate;
}): AgentReportSummaryV2 {
  const {
    agents,
    transactions,
    executions,
    approvals = [],
    paymentSplits = [],
    predicate,
  } = input;

  const filteredTxns: Transaction[] = [];
  for (const t of transactions) {
    if ((t as any).cancelled_at) continue;
    if (predicate && !predicate(rowAccountingDate(t as any))) continue;
    filteredTxns.push(t);
  }

  const splitCurrencyByTxnId = resolveSplitCurrencyByRef(
    paymentSplits as any,
    "transactions",
  );

  const txnsByAgent = new Map<string, Transaction[]>();
  for (const a of agents) txnsByAgent.set(a.id, []);
  for (const t of filteredTxns) {
    const aid = (t as any).agent_id as string | null;
    if (!aid) continue;
    const list = txnsByAgent.get(aid);
    if (list) list.push(t);
  }

  // Counts per agent remain operational and come from executed operations.
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
    for (const aid of seen) {
      execCountByAgent.set(aid, (execCountByAgent.get(aid) || 0) + 1);
    }
  }

  const filteredApprovals: any[] = [];
  const approvalCountByAgent = new Map<string, number>();
  for (const a of approvals) {
    if (predicate && !predicate(approvalDateOf(a))) continue;
    filteredApprovals.push(a);
    const aid = (a as any).agent_id;
    if (aid) {
      const key = String(aid);
      approvalCountByAgent.set(key, (approvalCountByAgent.get(key) || 0) + 1);
    }
  }

  const totalServices = new CurrencyMap();
  const totalPayments = new CurrencyMap();
  const totalDue = new CurrencyMap();

  const rows: AgentReportRow[] = agents.map((a) => {
    const ledgerRows = buildAgentLedgerRows(
      txnsByAgent.get(a.id) || [],
      splitCurrencyByTxnId,
    );

    const services = new CurrencyMap();
    const payments = new CurrencyMap();
    const due = new CurrencyMap();

    for (const row of ledgerRows) {
      services.add(row.currency, row.debit);
      payments.add(row.currency, row.credit);
      due.add(row.currency, row.debit - row.credit);
    }

    addMap(totalServices, services);
    addMap(totalPayments, payments);
    addMap(totalDue, due);

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
      services: totalServices,
      payments: totalPayments,
      due: totalDue,
      executionsCount: filteredExecutions.length,
      approvalsCount: filteredApprovals.length,
    },
    filteredExecutions,
    filteredTxns,
    filteredApprovals,
  };
}
