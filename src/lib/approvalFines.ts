import { supabase } from "@/integrations/supabase/client";

/**
 * Approval expiry fine logic — applies ONLY to "موافقة أمنية".
 *
 * Creates one fine per (source, source_id):
 *   - public.transactions          → agent debit  (price = fineAmount, paid = 0)
 *   - public.company_transactions  → company credit (cash_amount = total_paid = fineAmount)
 *
 * Idempotency: (source_service_type, source_service_id) where source_service_type
 * is "submission_fine" or "execution_fine".
 */

export const APPROVAL_SERVICE_LABEL = "موافقة أمنية";
export const FINE_LABEL = "غرامة مالية - انتهاء صلاحية الموافقة";
export const PENALTY_TYPE = "approval_expiry";

export type ApprovalFineSource = "submission" | "execution";

export interface ApprovalEntity {
  id: string;
  agent_id: string | null;
  approval_company_id: string | null;
  issue_date: string | null;
  approval_validity_enabled: boolean;
  /** submissions: string[]  |  executions: {service_type:string}[] */
  services: unknown;
}

export interface PenaltyScanReport {
  scanned: number;
  expired: number;
  created: number;
  skipped: Record<string, number>;
}

function hasApprovalService(services: unknown): boolean {
  if (!Array.isArray(services)) return false;
  return services.some((s: any) => {
    const name = typeof s === "string" ? s : (s?.service_type || "");
    return String(name).trim() === APPROVAL_SERVICE_LABEL;
  });
}

/**
 * Today's date in Africa/Cairo as "YYYY-MM-DD" — no time component, no UTC drift.
 */
export function cairoToday(): string {
  // en-CA → "YYYY-MM-DD"
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

/**
 * Add N days to a "YYYY-MM-DD" date using pure UTC math (no DST / TZ drift).
 * Returns "YYYY-MM-DD" or null.
 */
export function addDaysISO(isoDate: string | null, days: number): string | null {
  if (!isoDate) return null;
  const m = String(isoDate).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(t)) return null;
  const d = new Date(t + days * 86400000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function computeApprovalExpiry(issueDate: string | null, validityDays: number): string | null {
  if (!issueDate || !validityDays) return null;
  return addDaysISO(issueDate, validityDays);
}

/**
 * Status rule: today <= expiry → "جارية", today > expiry → "منتهية".
 * Pure YYYY-MM-DD lexicographic comparison.
 */
export function approvalStatusFor(issueDate: string | null, validityDays: number, today?: string): "جارية" | "منتهية" | null {
  const exp = computeApprovalExpiry(issueDate, validityDays);
  if (!exp) return null;
  const t = today || cairoToday();
  return t > exp ? "منتهية" : "جارية";
}


async function readSettings(): Promise<{ validityDays: number; fineAmount: number }> {
  const [{ data: dDays }, { data: dFine }] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "approval_validity_days").maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "approval_expiry_fine").maybeSingle(),
  ]);
  const validityDays = Number((dDays as any)?.value?.v) || 0;
  const fineAmount = Number((dFine as any)?.value?.v) || 0;
  return { validityDays, fineAmount };
}

export async function ensureApprovalFines(
  source: ApprovalFineSource,
  entities: ApprovalEntity[],
  validityDays: number,
  fineAmount: number,
  report?: PenaltyScanReport,
): Promise<number> {
  if (!(fineAmount > 0) || !(validityDays > 0) || !Array.isArray(entities) || entities.length === 0) return 0;

  const sourceType = source === "submission" ? "submission_fine" : "execution_fine";
  const today = cairoToday(); // "YYYY-MM-DD" in Africa/Cairo
  const skip = report?.skipped ?? ({} as Record<string, number>);
  const bump = (k: string) => { skip[k] = (skip[k] || 0) + 1; };

  const eligible: { id: string; agent_id: string; company_id: string; expiry: string }[] = [];
  for (const e of entities) {
    if (!e) { bump("invalid"); continue; }
    if (!e.approval_validity_enabled) { bump("validity_disabled"); continue; }
    if (!hasApprovalService(e.services)) { bump("not_security_approval"); continue; }
    if (!e.issue_date) { bump("no_issue_date"); continue; }
    if (!e.agent_id) { bump("no_agent"); continue; }
    if (!e.approval_company_id) { bump("no_company"); continue; }
    const expiry = computeApprovalExpiry(e.issue_date, validityDays);
    if (!expiry) { bump("invalid_issue_date"); continue; }
    // Rule: today > expiry → expired. today <= expiry → still valid.
    if (!(today > expiry)) { bump("not_yet_expired"); continue; }
    eligible.push({ id: String(e.id), agent_id: e.agent_id, company_id: e.approval_company_id, expiry });
  }


  if (report) report.expired += eligible.length;
  if (eligible.length === 0) return 0;
  const ids = eligible.map((x) => x.id);

  const [{ data: existingAgent }, { data: existingCompany }] = await Promise.all([
    supabase.from("transactions").select("source_service_id").eq("source_service_type", sourceType).in("source_service_id", ids),
    supabase.from("company_transactions").select("source_service_id").eq("source_service_type", sourceType).in("source_service_id", ids),
  ]);
  const haveAgent = new Set((existingAgent || []).map((r: any) => String(r.source_service_id)));
  const haveCompany = new Set((existingCompany || []).map((r: any) => String(r.source_service_id)));

  const agentRows = eligible
    .filter((x) => !haveAgent.has(x.id))
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
    .filter((x) => !haveCompany.has(x.id))
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

  const dupes = eligible.length - Math.max(agentRows.length, companyRows.length);
  if (dupes > 0 && report) skip["already_exists"] = (skip["already_exists"] || 0) + dupes;

  let created = 0;
  try {
    if (agentRows.length > 0) {
      const { error, data } = await supabase.from("transactions").insert(agentRows as any).select("id");
      if (error) console.error("[approvalFines] agent insert error:", error);
      else created += data?.length || 0;
    }
    if (companyRows.length > 0) {
      const { error, data } = await supabase.from("company_transactions").insert(companyRows as any).select("id");
      if (error) console.error("[approvalFines] company insert error:", error);
      else created += data?.length || 0;
    }
  } catch (e) {
    console.error("[approvalFines] insert exception:", e);
  }

  if (report) report.created += created;
  return created;
}

/**
 * Central scan: fetch all submissions + executions, evaluate, create missing fines.
 * Safe to call repeatedly. Returns a report and logs a debug summary to console.
 */
export async function processExpiredApprovalPenalties(opts?: { silent?: boolean }): Promise<PenaltyScanReport> {
  const report: PenaltyScanReport = { scanned: 0, expired: 0, created: 0, skipped: {} };
  const { validityDays, fineAmount } = await readSettings();

  if (!(validityDays > 0) || !(fineAmount > 0)) {
    if (!opts?.silent) {
      console.warn("[approvalFines] settings incomplete", { validityDays, fineAmount });
    }
    return report;
  }

  const [{ data: subs, error: subErr }, { data: execs, error: execErr }] = await Promise.all([
    supabase
      .from("submissions")
      .select("id, agent_id, approval_company_id, issue_date, approval_validity_enabled, services"),
    supabase
      .from("executions")
      .select("id, agent_id, approval_company_id, issue_date, approval_validity_enabled, services"),
  ]);
  if (subErr) console.error("[approvalFines] submissions read error:", subErr);
  if (execErr) console.error("[approvalFines] executions read error:", execErr);

  const subList = (subs || []) as any[];
  const execList = (execs || []) as any[];
  report.scanned = subList.length + execList.length;

  await ensureApprovalFines("submission", subList.map((s) => ({
    id: String(s.id),
    agent_id: s.agent_id,
    approval_company_id: s.approval_company_id,
    issue_date: s.issue_date,
    approval_validity_enabled: !!s.approval_validity_enabled,
    services: s.services,
  })), validityDays, fineAmount, report);

  await ensureApprovalFines("execution", execList.map((e) => ({
    id: String(e.id),
    agent_id: e.agent_id,
    approval_company_id: e.approval_company_id,
    issue_date: e.issue_date,
    approval_validity_enabled: !!e.approval_validity_enabled,
    services: e.services,
  })), validityDays, fineAmount, report);

  if (!opts?.silent) {
    console.info("[approvalFines] scan report", {
      scanned: report.scanned,
      expired: report.expired,
      created: report.created,
      skipped: report.skipped,
      settings: { validityDays, fineAmount },
    });
  }

  return report;
}
