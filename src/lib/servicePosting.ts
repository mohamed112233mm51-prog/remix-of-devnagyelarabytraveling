import { supabase } from "@/integrations/supabase/client";
import { logCreate } from "@/lib/financialAudit";

/**
 * Service financial posting helpers.
 *
 * When a service (flight / approval / libyan investment) is submitted from
 * "تقديم خدمة", we automatically post:
 *   - a debt row on the selected AGENT (public.transactions, total_paid = 0)
 *   - a debt row on the selected ISSUING COMPANY (public.company_transactions)
 *
 * Both rows store source_service_id + source_service_type so future edits
 * keep them in sync (UPDATE by source_service_id) and deletes can reverse.
 *
 * IMPORTANT: The agent statement (كشف حساب الوكيل) layout / calculations
 * MUST remain identical. We only INSERT rows shaped exactly like manual
 * transactions, so the existing statement renders them with zero changes.
 */

export type ServiceKind = "flight_ticket" | "security_approval" | "libyan_investment";

const SERVICE_LABEL_AR: Record<ServiceKind, string> = {
  flight_ticket: "تذاكر طيران",
  security_approval: "موافقة أمنية",
  libyan_investment: "استثمار ليبي",
};

export interface ServicePostingInput {
  serviceId: string;
  serviceKind: ServiceKind;
  agentId: string | null;
  companyId: string | null;
  date: string | null;           // travel_date or fallback (yyyy-mm-dd)
  destination: string | null;
  travelStatement: string | null;
  passengerName: string | null;
  count: number;                 // agent: trip count
  price: number;                 // agent: unit price
  companyValue: number;          // company-side debt amount
}

function safeDate(d: string | null | undefined): string {
  if (d && typeof d === "string" && d.length >= 8) return d;
  return new Date().toISOString().slice(0, 10);
}

function agentRow(input: ServicePostingInput & { agentId: string }) {
  const count = Math.max(1, Math.round(Number(input.count) || 1));
  const price = Math.max(0, Number(input.price) || 0);
  return {
    agent_id: input.agentId,
    date: safeDate(input.date),
    destination: input.destination ?? undefined,
    travel_statement: null,
    service_type: SERVICE_LABEL_AR[input.serviceKind],
    count,
    price,
    instapay_amount: 0,
    cash_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    merchant_id: undefined,
    total_paid: 0,
    paid: 0,
    note: input.passengerName ?? undefined,
    source_service_id: input.serviceId,
    source_service_type: input.serviceKind,
  };
}

function companyRow(input: ServicePostingInput & { companyId: string }) {
  const value = Math.max(0, Number(input.companyValue) || 0);
  return {
    company_id: input.companyId,
    date: safeDate(input.date),
    destination: input.destination ?? undefined,
    service_type: SERVICE_LABEL_AR[input.serviceKind],
    count: 1,
    price: value,
    trip_value: value,
    instapay_amount: 0,
    cash_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    merchant_id: undefined,
    total_paid: 0,
    note: input.passengerName ?? undefined,
    source_service_id: input.serviceId,
    source_service_type: input.serviceKind,
  };
}

/** Called after INSERT of a new service record. Creates both debt rows. */
export async function postServiceFinancials(input: ServicePostingInput): Promise<void> {
  if (input.agentId) {
    const { error } = await supabase
      .from("transactions")
      .insert(agentRow({ ...input, agentId: input.agentId }));
    if (error) throw new Error(`فشل إنشاء حركة الوكيل: ${error.message}`);
  }
  if (input.companyId && Number(input.companyValue) > 0) {
    const { error } = await supabase
      .from("company_transactions")
      .insert(companyRow({ ...input, companyId: input.companyId }));
    if (error) throw new Error(`فشل إنشاء حركة الشركة: ${error.message}`);
  }
}

/**
 * Called when a service is edited. UPDATEs the linked rows if they exist,
 * INSERTs them if they don't (e.g. legacy services created before posting).
 *
 * Only fields safe to overwrite are touched. We DO NOT overwrite payment
 * fields (instapay/cash/merchant/total_paid) — those belong to the agent
 * payment workflow and must survive service edits.
 */
export async function updateServiceFinancials(input: ServicePostingInput): Promise<void> {
  // --- Agent side ---
  if (input.agentId) {
    const { data: existing, error: selErr } = await supabase
      .from("transactions")
      .select("id")
      .eq("source_service_id", input.serviceId)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    const base = agentRow({ ...input, agentId: input.agentId });
    if (existing?.id) {
      // Update only structural fields; leave payment fields untouched
      const { error } = await supabase
        .from("transactions")
        .update({
          agent_id: base.agent_id,
          date: base.date,
          destination: base.destination,
          travel_statement: null,
          service_type: base.service_type,
          count: base.count,
          price: base.price,
          note: base.note,
          source_service_type: base.source_service_type,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from("transactions").insert(base).select("id").single();
      if (error) throw new Error(error.message);
      if (data?.id) await logCreate("transactions", data.id, { ...base, id: data.id }, "توليد من تقديم خدمة");
    }
  }

  // --- Company side ---
  if (input.companyId) {
    const { data: existing, error: selErr } = await supabase
      .from("company_transactions")
      .select("id")
      .eq("source_service_id", input.serviceId)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    const value = Math.max(0, Number(input.companyValue) || 0);
    const base = companyRow({ ...input, companyId: input.companyId });
    if (existing?.id) {
      if (value > 0) {
        const { error } = await supabase
          .from("company_transactions")
          .update({
            company_id: base.company_id,
            date: base.date,
            destination: base.destination,
            service_type: base.service_type,
            count: base.count,
            price: base.price,
            trip_value: base.trip_value,
            note: base.note,
            source_service_type: base.source_service_type,
          })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        // Value cleared on edit → remove the company debt row
        const { error } = await supabase
          .from("company_transactions")
          .delete()
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      }
    } else if (value > 0) {
      const { error } = await supabase.from("company_transactions").insert(base);
      if (error) throw new Error(error.message);
    }
  }
}

/** Reverse / remove the financial rows linked to a deleted service. */
export async function deleteServiceLinkedRows(serviceId: string): Promise<void> {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from("transactions").delete().eq("source_service_id", serviceId),
    supabase.from("company_transactions").delete().eq("source_service_id", serviceId),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
}
