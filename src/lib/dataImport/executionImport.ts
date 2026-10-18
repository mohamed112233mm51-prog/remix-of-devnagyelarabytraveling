import { supabase } from "@/integrations/supabase/client";
import { postExecutionFinancials } from "@/lib/executionPosting";
import { splitExecutionServiceNames } from "./executionImportConfig";

export type ExecutionImportResult = { insertedIds: string[]; failed: number };

function normalizeCurrency(value: unknown): "EGP" | "USD" | "LYD" {
  const cur = String(value || "EGP").trim().toUpperCase();
  return cur === "USD" || cur === "LYD" ? cur : "EGP";
}

function executionCore(row: Record<string, any>, services: any[]) {
  return {
    passenger_name: String(row.passenger_name || "").trim(),
    national_id: row.national_id || null,
    dob: row.dob || null,
    passport: row.passport || null,
    birth_place: row.birth_place || null,
    agent_id: row.agent_id || null,
    status: row.status || "",
    operation_status: row.operation_status || "",
    departure_from: row.departure_from || null,
    destination: row.destination || null,
    airline: row.airline || null,
    travel_date: row.travel_date || null,
    notes: row.notes || null,
    approval_company_id: row.approval_company_id || null,
    passenger_type: row.passenger_type || null,
    issue_date: row.issue_date || null,
    approval_validity_enabled: !!row.approval_validity_enabled,
    services,
  };
}

/** Preserve support for older execution import files that carried one priced service per row. */
function serviceFromLegacyRow(row: Record<string, any>) {
  const rawKind = String(row._service_kind || "").trim();
  const serviceType = String(row._service_type || "").trim();
  if (!rawKind && !serviceType) return null;

  const isCompany = rawKind.includes("شركة") || rawKind.toLowerCase() === "company";
  const isAgent = rawKind.includes("وكيل") || rawKind.toLowerCase() === "agent";
  if (!isCompany && !isAgent) throw new Error(`طرف الخدمة غير صحيح: ${rawKind}`);

  const common = {
    kind: isCompany ? "company" as const : "agent" as const,
    service_type: serviceType,
    count: Math.max(1, Math.round(Number(row._service_count || 1))),
    currency: normalizeCurrency(row._service_currency),
    note: row._service_note || null,
  };

  if (isCompany) {
    if (!row._service_company_id) throw new Error("شركة الخدمة مطلوبة لسطر خدمة الشركة");
    return {
      ...common,
      company_id: row._service_company_id,
      company_price: Math.max(0, Number(row._company_price || 0)),
      company_value: Math.max(0, Number(row._company_value || 0)),
    };
  }

  return { ...common, agent_price: Math.max(0, Number(row._agent_price || 0)) };
}

/**
 * New compact format: many service names may live in the same Excel cell.
 * These items intentionally carry no price/company assignment, so importing a
 * completed operation never invents financial debt from incomplete pricing data.
 */
function compactServicesFromRow(row: Record<string, any>) {
  const agentServices = splitExecutionServiceNames(row._agent_services).map((serviceType) => ({
    kind: "agent" as const,
    service_type: serviceType,
    count: 1,
    agent_price: 0,
  }));
  const companyServices = splitExecutionServiceNames(row._company_services).map((serviceType) => ({
    kind: "company" as const,
    service_type: serviceType,
    company_id: null,
    count: 1,
    company_price: 0,
    company_value: 0,
  }));
  return [...agentServices, ...companyServices];
}

function dedupeServices(services: any[]) {
  const seen = new Set<string>();
  return services.filter((service) => {
    const kind = String(service?.kind || "legacy");
    const name = String(service?.service_type || "").trim();
    if (!name) return false;
    const key = `${kind}:${name.toLocaleLowerCase("ar")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function importExecutionRows(
  rows: Record<string, any>[],
  onProgress: (done: number, total: number) => void,
): Promise<ExecutionImportResult> {
  const groups = new Map<string, Record<string, any>[]>();
  rows.forEach((row, index) => {
    // Legacy files may still carry an explicit import group. The current
    // template always uses one Excel row per execution.
    const explicitKey = String(row._import_group || "").trim();
    const key = explicitKey || `__row_${index}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  });

  const entries = Array.from(groups.entries());
  const insertedIds: string[] = [];
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const [, groupRows] = entries[i];
    try {
      const first = groupRows[0];
      const identity = `${first.passenger_name || ""}|${first.passport || ""}|${first.national_id || ""}|${first.agent_id || ""}`;
      const inconsistent = groupRows.some((row) =>
        `${row.passenger_name || ""}|${row.passport || ""}|${row.national_id || ""}|${row.agent_id || ""}` !== identity,
      );
      if (inconsistent) throw new Error("بيانات المسافر غير متطابقة داخل نفس كود التنفيذ");

      const legacyServices = groupRows
        .map(serviceFromLegacyRow)
        .filter((service): service is NonNullable<typeof service> => service !== null);
      const compactServices = groupRows.flatMap(compactServicesFromRow);
      const services = dedupeServices([...legacyServices, ...compactServices]);
      const payload = executionCore(first, services);

      const { executionId } = await postExecutionFinancials({ executionPatch: payload, refresh: false });

      if (payload.operation_status === "منفذ" && services.length > 0) {
        try {
          const { data: exRow } = await supabase
            .from("executions")
            .select("id,travel_date,created_at,operation_status,services,fx_locks,fx_locked_at")
            .eq("id", executionId)
            .maybeSingle();
          if (exRow) {
            const { ensureExecutionFxLocks } = await import("@/lib/executionProfit");
            await ensureExecutionFxLocks(supabase as any, exRow as any);
          }
        } catch { /* FX lock stays pending exactly like normal execution flow */ }
      }

      insertedIds.push(executionId);
    } catch {
      failed++;
      // The RPC rolled back the execution and all its debts together.
    }
    onProgress(i + 1, entries.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { insertedIds, failed };
}
