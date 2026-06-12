// Opening balance ("الرصيد السابق") sync helpers.
// Stores entered values on the entity (agents / issuing_companies) AND mirrors
// them as a single opening transaction row per side in the matching ledger
// table, so the running balance includes them without changing any existing
// calculation logic.
//
// Identification of the opening rows is stable per entity:
//   source_service_type = 'opening_debit' | 'opening_credit'
//   source_service_id   = entity uuid
// On every save we delete the existing opening rows for that entity then
// re-insert only the sides the user actually entered (>0).
import { supabase } from "@/integrations/supabase/client";

export type OpeningBalanceInput = {
  debit: number;
  credit: number;
  date: string | null; // YYYY-MM-DD
  note: string | null;
};

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function syncAgentOpeningBalance(agentId: string, op: OpeningBalanceInput) {
  if (!agentId) return;
  const date = op.date || todayISO();
  const debit = Math.max(0, Number(op.debit) || 0);
  const credit = Math.max(0, Number(op.credit) || 0);

  // Always wipe any prior opening rows for this agent so editing never duplicates.
  await supabase
    .from("transactions")
    .delete()
    .eq("agent_id", agentId)
    .in("source_service_type", ["opening_debit", "opening_credit"] as any);

  const rows: any[] = [];
  if (debit > 0) {
    rows.push({
      agent_id: agentId,
      date,
      destination: null,
      count: 1,
      price: debit,
      paid: 0,
      total_paid: 0,
      cash_amount: 0,
      instapay_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      payment_method: "نقدي",
      service_type: "رصيد سابق",
      travel_statement: "رصيد سابق",
      note: op.note || null,
      source_service_type: "opening_debit",
      source_service_id: agentId,
    });
  }
  if (credit > 0) {
    rows.push({
      agent_id: agentId,
      date,
      destination: null,
      count: 0,
      price: 0,
      paid: credit,
      total_paid: credit,
      cash_amount: credit,
      instapay_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      payment_method: "نقدي",
      service_type: "رصيد سابق",
      travel_statement: "رصيد سابق",
      note: op.note || null,
      source_service_type: "opening_credit",
      source_service_id: agentId,
    });
  }
  if (rows.length) {
    await supabase.from("transactions").insert(rows as any);
  }
}

export async function syncCompanyOpeningBalance(companyId: string, op: OpeningBalanceInput) {
  if (!companyId) return;
  const date = op.date || todayISO();
  const debit = Math.max(0, Number(op.debit) || 0);
  const credit = Math.max(0, Number(op.credit) || 0);

  await supabase
    .from("company_transactions")
    .delete()
    .eq("company_id", companyId)
    .in("source_service_type", ["opening_debit", "opening_credit"] as any);

  const rows: any[] = [];
  if (debit > 0) {
    rows.push({
      company_id: companyId,
      date,
      destination: null,
      count: 1,
      price: debit,
      trip_value: debit,
      total_paid: 0,
      cash_amount: 0,
      instapay_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      service_type: "رصيد سابق",
      note: op.note || null,
      source_service_type: "opening_debit",
      source_service_id: companyId,
    });
  }
  if (credit > 0) {
    rows.push({
      company_id: companyId,
      date,
      destination: null,
      count: 0,
      price: 0,
      trip_value: 0,
      total_paid: credit,
      cash_amount: credit,
      instapay_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      service_type: "رصيد سابق",
      note: op.note || null,
      source_service_type: "opening_credit",
      source_service_id: companyId,
    });
  }
  if (rows.length) {
    await supabase.from("company_transactions").insert(rows as any);
  }
}
