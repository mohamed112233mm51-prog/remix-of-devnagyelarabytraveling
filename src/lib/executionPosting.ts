import { supabase } from "@/integrations/supabase/client";
import type { ExecutionServiceItem } from "@/lib/db";

/**
 * Execution financial posting.
 *
 * An execution may carry multiple services for the same customer. For each
 * service we create:
 *  - one agent debt row in `transactions` (total_paid = 0, payment fields = 0)
 *  - one company debt row in `company_transactions` (if a company is set)
 *
 * Both rows are linked back to the execution via
 *   source_service_id   = `${executionId}::${index}`
 *   source_service_type = `execution`
 * so re-posting / cancellation can wipe & rewrite cleanly without touching
 * unrelated rows.
 *
 * Status policy:
 *  - status === "منفذ" → rows exist
 *  - any other status   → rows are removed
 */

export interface ExecutionPostingInput {
  executionId: string;
  status: string;
  agentId: string | null;
  date: string | null;          // travel_date or today
  destination: string | null;
  airline: string | null;
  passengerName: string | null;
  services: ExecutionServiceItem[];
}

function safeDate(d: string | null | undefined): string {
  if (d && typeof d === "string" && d.length >= 8) return d;
  return new Date().toISOString().slice(0, 10);
}

const travelStatement = (input: ExecutionPostingInput) =>
  [input.destination, input.date, input.airline].filter(Boolean).join(" - ") || null;

async function deleteLinked(executionId: string) {
  // We use prefix matching: `${executionId}::%`
  const prefix = `${executionId}::`;
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from("transactions").delete().like("source_service_id", `${prefix}%`),
    supabase.from("company_transactions").delete().like("source_service_id", `${prefix}%`),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
}

/**
 * Idempotent: removes any previously-posted rows for this execution, then
 * (if status === "منفذ") inserts fresh rows for every service item.
 */
export async function postExecutionFinancials(input: ExecutionPostingInput): Promise<void> {
  await deleteLinked(input.executionId);
  if (input.status !== "منفذ") return;

  const date = safeDate(input.date);
  const note = input.passengerName ?? null;
  const stmt = travelStatement(input);

  const agentRows: any[] = [];
  const companyRows: any[] = [];

  input.services.forEach((s, i) => {
    const linkId = `${input.executionId}::${i}`;
    const count = Math.max(1, Math.round(Number(s.count) || 1));
    const agentPrice = Math.max(0, Number(s.agent_price) || 0);
    const companyValue = Math.max(0, Number(s.company_value) || 0);

    // Distribute paid_amount into the matching bucket
    const paid = Math.max(0, Number(s.paid_amount) || 0);
    const pm = s.payment_method || "";
    const buckets = {
      instapay_amount: 0,
      cash_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
    };
    if (paid > 0) {
      if (pm === "إنستاباي") buckets.instapay_amount = paid;
      else if (pm === "نقدي") buckets.cash_amount = paid;
      else if (pm === "محفظة") { buckets.mobile_cash_amount = paid; buckets.mobile_cash_net_amount = Math.round(paid - paid * 0.01); }
      else if (pm === "تاجر إنستاباي") buckets.merchant_cash_amount = paid;
      else if (pm === "تاجر محفظة") { buckets.merchant_cash_amount = paid; buckets.merchant_cash_net_amount = Math.round(paid - paid * 0.01); }
      else if (pm === "تاجر نقدي") buckets.merchant_cash_physical_amount = paid;
      else buckets.cash_amount = paid;
    }
    const totalPaid = buckets.instapay_amount + buckets.cash_amount + buckets.mobile_cash_net_amount + buckets.merchant_cash_net_amount + buckets.merchant_cash_physical_amount + (buckets.merchant_cash_amount && !buckets.merchant_cash_net_amount ? buckets.merchant_cash_amount : 0);

    if (input.agentId) {
      agentRows.push({
        agent_id: input.agentId,
        date,
        destination: input.destination ?? undefined,
        travel_statement: stmt ?? undefined,
        service_type: s.service_type,
        count,
        price: agentPrice,
        ...buckets,
        merchant_id: s.merchant_id || null,
        payment_method: pm || "نقدي",
        total_paid: totalPaid,
        paid: totalPaid,
        note,
        source_service_id: linkId,
        source_service_type: "execution",
      });
    }

    if (s.company_id && companyValue > 0) {
      companyRows.push({
        company_id: s.company_id,
        date,
        destination: input.destination ?? undefined,
        service_type: s.service_type,
        count: 1,
        price: companyValue,
        trip_value: companyValue,
        instapay_amount: 0,
        cash_amount: 0,
        mobile_cash_amount: 0,
        mobile_cash_net_amount: 0,
        arabic_tourism_cash_amount: 0,
        arabic_tourism_cash_net_amount: 0,
        merchant_cash_amount: 0,
        merchant_cash_net_amount: 0,
        merchant_cash_physical_amount: 0,
        total_paid: 0,
        note,
        source_service_id: linkId,
        source_service_type: "execution",
      });
    }
  });

  if (agentRows.length) {
    const { error } = await supabase.from("transactions").insert(agentRows);
    if (error) throw new Error(`فشل إنشاء حركات الوكيل: ${error.message}`);
  }
  if (companyRows.length) {
    const { error } = await supabase.from("company_transactions").insert(companyRows);
    if (error) throw new Error(`فشل إنشاء حركات الشركة: ${error.message}`);
  }
}

export async function deleteExecutionLinkedRows(executionId: string): Promise<void> {
  await deleteLinked(executionId);
}
