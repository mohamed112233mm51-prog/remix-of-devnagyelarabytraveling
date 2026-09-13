import { supabase } from "@/integrations/supabase/client";
import type { ReconciliationExecution } from "@/lib/executionTripReconciliation";

export type TripDateRange = { from: string; to: string };
export type ReconciliationReferenceLabels = {
  companies: Array<{ value: string; label: string }>;
  agents: Record<string, string>;
};

export function buildTripDateRange(value: string): TripDateRange | null {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const current = new Date(Date.UTC(year, month - 1, day));
  if (
    current.getUTCFullYear() !== year ||
    current.getUTCMonth() !== month - 1 ||
    current.getUTCDate() !== day
  ) return null;

  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { from: raw, to: next.toISOString().slice(0, 10) };
}

export async function fetchReconciliationExecutionsForDate(
  travelDate: string,
): Promise<ReconciliationExecution[]> {
  const range = buildTripDateRange(travelDate);
  if (!range) return [];

  const { data, error } = await supabase
    .from("executions")
    .select(
      "id,passenger_name,passport,national_id,operation_status,travel_date,departure_from,destination,airline,approval_company_id,agent_id",
    )
    .gte("travel_date", range.from)
    .lt("travel_date", range.to);

  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ReconciliationExecution[];
}

export async function fetchReconciliationReferenceLabels(
  executions: readonly ReconciliationExecution[],
): Promise<ReconciliationReferenceLabels> {
  const companyIds = Array.from(new Set(
    executions.map((item) => String(item.approval_company_id || "").trim()).filter(Boolean),
  ));
  const agentIds = Array.from(new Set(
    executions.map((item) => String(item.agent_id || "").trim()).filter(Boolean),
  ));

  const [companyResult, agentResult] = await Promise.all([
    companyIds.length
      ? supabase.from("issuing_companies").select("id,company_name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null } as any),
    agentIds.length
      ? supabase.from("agents").select("id,name").in("id", agentIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (companyResult.error) throw companyResult.error;
  if (agentResult.error) throw agentResult.error;

  const companies = (Array.isArray(companyResult.data) ? companyResult.data : [])
    .map((company: any) => ({ value: String(company.id), label: String(company.company_name || company.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));

  const agents: Record<string, string> = {};
  for (const agent of Array.isArray(agentResult.data) ? agentResult.data : []) {
    if (agent?.id) agents[String(agent.id)] = String(agent.name || agent.id);
  }

  return { companies, agents };
}
