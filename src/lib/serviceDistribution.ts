// Shared metric for service-type distribution used by:
//   - Dashboard: "عدد التنفيذات المنفذة حسب نوع الخدمة"
//   - Reports:   "توزيع أنواع خدمات الوكلاء / الشركات"
//   - Any PDF / Excel export derived from the above
//
// Rules (must not diverge):
//   1. Only executions with operation_status === "منفذ" are counted.
//   2. Value per service = number of DISTINCT executions containing that
//      normalized service type. `services[i].count` (passenger / unit
//      count) is NEVER used here — it belongs to the financial engine.
//   3. If a single execution lists the same service_type twice, it counts
//      once for that service (Set-per-execution).
//   4. Percentage denominator = total number of distinct executed executions.
//      Because one execution can contain several service types, the sum of
//      percentages can exceed 100 % — this is expected.
//
// Financial reports (agent_price × count, company_price × count, profit …)
// keep their own logic and MUST NOT use this file.

export type ServiceLike = {
  service_type?: string | null;
  type?: string | null;
  name?: string | null;
};

export type ExecutionLike = {
  id: string;
  operation_status?: string | null;
  services?: (ServiceLike | string | null | undefined)[] | null;
};

export type ServiceExecutionDistributionItem = {
  label: string;
  executionCount: number;
  percentageOfExecutions: number;
  /** Distinct execution ids used to build this bucket (for drill-down). */
  executionIds: string[];
};

/** Normalize a service_type label. Trim + collapse internal whitespace only. */
export function normalizeServiceType(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function extractLabel(s: ServiceLike | string | null | undefined): string {
  if (s == null) return "";
  const raw = typeof s === "string" ? s : (s.service_type || s.type || s.name || "");
  return normalizeServiceType(raw);
}

/**
 * Distinct-execution count per normalized service type.
 * @param executions Any list of executions — the function itself applies
 *                   the `operation_status === "منفذ"` filter, so callers
 *                   just pass their period-scoped list.
 */
export function computeServiceExecutionDistribution(
  executions: ExecutionLike[],
): {
  items: ServiceExecutionDistributionItem[];
  totalExecuted: number;
} {
  const executedIds = new Set<string>();
  const executionIdsByService = new Map<string, Set<string>>();

  for (const ex of executions) {
    if (!ex || (ex.operation_status || "") !== "منفذ") continue;
    executedIds.add(ex.id);

    const typesInExecution = new Set<string>();
    const svc = Array.isArray(ex.services) ? ex.services : [];
    for (const s of svc) {
      const label = extractLabel(s);
      if (!label) continue;
      typesInExecution.add(label);
    }
    for (const label of typesInExecution) {
      let ids = executionIdsByService.get(label);
      if (!ids) { ids = new Set(); executionIdsByService.set(label, ids); }
      ids.add(ex.id);
    }
  }

  const totalExecuted = executedIds.size;
  const items: ServiceExecutionDistributionItem[] = Array
    .from(executionIdsByService.entries())
    .map(([label, ids]) => ({
      label,
      executionCount: ids.size,
      percentageOfExecutions: totalExecuted > 0 ? (ids.size / totalExecuted) * 100 : 0,
      executionIds: Array.from(ids),
    }))
    .sort((a, b) => (
      b.executionCount !== a.executionCount
        ? b.executionCount - a.executionCount
        : a.label.localeCompare(b.label, "ar")
    ));

  return { items, totalExecuted };
}
