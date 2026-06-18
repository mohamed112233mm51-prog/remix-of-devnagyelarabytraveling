import { supabase } from "@/integrations/supabase/client";

/**
 * Approval expiry fine logic — applies ONLY to "موافقة أمنية".
 *
 * For each expired approval we ensure exactly one fine row exists on:
 *   - public.transactions (agent side, debit)        source_service_type=submission_fine|execution_fine
 *   - public.company_transactions (company, credit)  source_service_type=submission_fine|execution_fine
 *
 * Duplicates are prevented via (source_service_type, source_service_id).
 */

export const APPROVAL_SERVICE_LABEL = "موافقة أمنية";
export const FINE_LABEL = "غرامة مالية - انتهاء صلاحية الموافقة";

export type ApprovalFineSource = "submission" | "execution";

export interface ApprovalEntity {
  id: string;
  agent_id: string | null;
  approval_company_id: string | null;
  issue_date: string | null;
  approval_validity_enabled: boolean;
  /** submissions: string[]; executions: {service_type:string}[] */
  services: unknown;
}

function hasApprovalService(services: unknown): boolean {
  if (!Array.isArray(services)) return false;
  return services.some((s: any) => {
    const name = typeof s === "string" ? s : (s?.service_type || "");
    return String(name).trim() === APPROVAL_SERVICE_LABEL;
  });
}

export function computeApprovalExpiry(issueDate: string | null, validityDays: number): string | null {
  if (!issueDate || !validityDays) return null;
  const base = new Date(issueDate + "T00:00:00");
  if (Number.isNaN(base.getTime())) return null;
  const exp = new Date(base.getTime());
  exp.setDate(exp.getDate() + validityDays);
  return exp.toISOString().slice(0, 10);
}

export async function ensureApprovalFines(
  source: ApprovalFineSource,
  entities: ApprovalEntity[],
  validityDays: number,
  fineAmount: number,
): Promise<void> {
  if (!(fineAmount > 0) || !(validityDays > 0) || !Array.isArray(entities) || entities.length === 0) return;

  const sourceType = source === "submission" ? "submission_fine" : "execution_fine";
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const eligible = entities
    .map((e) => {
      if (!e || !e.approval_validity_enabled) return null;
      if (!hasApprovalService(e.services)) return null;
      const expiry = computeApprovalExpiry(e.issue_date, validityDays);
      if (!expiry) return null;
      const exp = new Date(expiry + "T00:00:00");
      if (exp.getTime() > today.getTime()) return null; // not yet expired
      return { id: String(e.id), agent_id: e.agent_id, company_id: e.approval_company_id, expiry };
    })
    .filter((x): x is { id: string; agent_id: string | null; company_id: string | null; expiry: string } => !!x);

  if (eligible.length === 0) return;
  const ids = eligible.map((x) => x.id);

  // Existing fines (agent + company) — keyed by source_service_id
  const [{ data: existingAgent }, { data: existingCompany }] = await Promise.all([
    supabase.from("transactions").select("source_service_id").eq("source_service_type", sourceType).in("source_service_id", ids),
    supabase.from("company_transactions").select("source_service_id").eq("source_service_type", sourceType).in("source_service_id", ids),
  ]);
  const haveAgent = new Set((existingAgent || []).map((r: any) => String(r.source_service_id)));
  const haveCompany = new Set((existingCompany || []).map((r: any) => String(r.source_service_id)));

  const agentRows = eligible
    .filter((x) => x.agent_id && !haveAgent.has(x.id))
    .map((x) => ({
      agent_id: x.agent_id,
      date: x.expiry,
      destination: "—",
      count: 1,
      price: fineAmount,
      paid: 0,
      total_paid: 0,
      service_type: FINE_LABEL,
      travel_statement: FINE_LABEL,
      note: FINE_LABEL,
      source_service_type: sourceType,
      source_service_id: x.id,
    }));

  const companyRows = eligible
    .filter((x) => x.company_id && !haveCompany.has(x.id))
    .map((x) => ({
      company_id: x.company_id,
      date: x.expiry,
      destination: "—",
      service_type: FINE_LABEL,
      count: 1,
      price: 0,
      trip_value: 0,
      total_paid: fineAmount,
      cash_amount: fineAmount,
      note: FINE_LABEL,
      source_service_type: sourceType,
      source_service_id: x.id,
    }));

  try {
    if (agentRows.length > 0) await supabase.from("transactions").insert(agentRows as any);
    if (companyRows.length > 0) await supabase.from("company_transactions").insert(companyRows as any);
  } catch {
    // swallow — fine creation must never break the UI
  }
}
