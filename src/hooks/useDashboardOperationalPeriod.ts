import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";
import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import {
  txnCollectedAmount,
  useLive,
  type Agent,
  type IssuingCompany,
  type Submission,
  type Transaction,
} from "@/lib/db";
import { computeServiceExecutionDistribution } from "@/lib/serviceDistribution";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

type ExecutionRow = {
  id: string;
  created_at?: string | null;
  operation_status?: string | null;
  submission_id?: string | null;
  services?: unknown;
  destination?: string | null;
  cancelled_at?: string | null;
};

export type DashboardTopAgent = {
  id: string;
  name: string;
  count: number;
  collected: number;
};

export type DashboardTopCompany = {
  id: string;
  name: string;
  count: number;
  topService: string;
};

export type DashboardServiceItem = {
  label: string;
  value: number;
  pct: number;
};

export type DashboardDestinationItem = {
  name: string;
  count: number;
  pct: number;
};

export type DashboardOperationalPeriod = {
  submissionsCount: number;
  executionsCount: number;
  topAgents: DashboardTopAgent[];
  topCompanies: DashboardTopCompany[];
  serviceDistribution: DashboardServiceItem[];
  serviceTotal: number;
  topDestinations: DashboardDestinationItem[];
};

/**
 * مؤشرات تشغيلية للداشبورد فقط.
 * - التقديمات والتنفيذات والتحليلات التشغيلية: created_at.
 * - تحصيلات الوكلاء: date ثم created_at.
 * - لا يكتب أو يعدّل أي حركة في قاعدة البيانات.
 */
export function useDashboardOperationalPeriod(period: SummaryPeriod): DashboardOperationalPeriod {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: submissions } = useCompleteFinancialTable<Submission>("submissions");
  const { rows: executions } = useCompleteFinancialTable<ExecutionRow>("executions");
  const { rows: transactions } = useCompleteFinancialTable<Transaction>("transactions");
  const todayISO = cairoToday();

  return useMemo(() => {
    const periodSubmissions = submissions.filter((row) =>
      isDateInSummaryPeriod((row as any).created_at, period, todayISO),
    );
    const periodExecutions = executions.filter((row) =>
      !row.cancelled_at
      && isDateInSummaryPeriod(row.created_at, period, todayISO),
    );
    const executedRows = periodExecutions.filter(
      (row) => String(row.operation_status || "").trim() === "منفذ",
    );

    const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
    const agentCollections = new Map<string, { count: number; collected: number }>();
    for (const transaction of transactions) {
      if ((transaction as any).cancelled_at || !transaction.agent_id) continue;
      const accountingDate = transaction.date || (transaction as any).created_at || null;
      if (!isDateInSummaryPeriod(accountingDate, period, todayISO)) continue;
      const amount = txnCollectedAmount(transaction);
      if (!amount) continue;
      const current = agentCollections.get(transaction.agent_id) || { count: 0, collected: 0 };
      current.count += 1;
      current.collected += amount;
      agentCollections.set(transaction.agent_id, current);
    }
    const topAgents = Array.from(agentCollections.entries())
      .map(([id, value]) => ({
        id,
        name: agentNames.get(id) || "وكيل محذوف",
        count: value.count,
        collected: value.collected,
      }))
      .sort((a, b) => b.collected - a.collected || b.count - a.count)
      .slice(0, 5);

    const companyNames = new Map(companies.map((company) => [company.id, company.company_name]));
    const companyStats = new Map<string, { count: number; services: Map<string, number> }>();
    for (const execution of executedRows) {
      const services = Array.isArray(execution.services) ? execution.services : [];
      for (const rawService of services) {
        if (!rawService || typeof rawService !== "object") continue;
        const service = rawService as Record<string, unknown>;
        if (service.kind !== "company") continue;
        const companyId = String(service.company_id || "").trim();
        if (!companyId) continue;
        const count = Math.max(1, Math.round(Number(service.count) || 1));
        const label = String(service.service_type || service.type || service.name || "—").trim() || "—";
        const current = companyStats.get(companyId) || { count: 0, services: new Map<string, number>() };
        current.count += count;
        current.services.set(label, (current.services.get(label) || 0) + count);
        companyStats.set(companyId, current);
      }
    }
    const topCompanies = Array.from(companyStats.entries())
      .map(([id, value]) => {
        let topService = "—";
        let max = 0;
        value.services.forEach((count, label) => {
          if (count > max) {
            max = count;
            topService = label;
          }
        });
        return {
          id,
          name: companyNames.get(id) || "شركة محذوفة",
          count: value.count,
          topService,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const serviceResult = computeServiceExecutionDistribution(executedRows as any);
    const serviceDistribution = serviceResult.items.map((item) => ({
      label: item.label,
      value: item.executionCount,
      pct: Math.round(item.percentageOfExecutions),
    }));

    const submissionDestinations = new Map<string, string>();
    for (const submission of submissions) {
      const destination = String((submission as any).destination || "").trim();
      if (destination) submissionDestinations.set(submission.id, destination);
    }
    const destinations = new Map<string, number>();
    for (const execution of executedRows) {
      const direct = String(execution.destination || "").trim();
      const destination = direct
        || (execution.submission_id ? submissionDestinations.get(execution.submission_id) || "" : "");
      if (!destination) continue;
      destinations.set(destination, (destinations.get(destination) || 0) + 1);
    }
    const destinationTotal = Array.from(destinations.values()).reduce((sum, value) => sum + value, 0) || 1;
    const topDestinations = Array.from(destinations.entries())
      .map(([name, count]) => ({ name, count, pct: Math.round((count / destinationTotal) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return {
      submissionsCount: periodSubmissions.length,
      executionsCount: executedRows.length,
      topAgents,
      topCompanies,
      serviceDistribution,
      serviceTotal: serviceResult.totalExecuted,
      topDestinations,
    };
  }, [agents, companies, submissions, executions, transactions, period, todayISO]);
}
