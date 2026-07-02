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
      travel_statement: null,
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
      travel_statement: null,
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

// ---------------- Merchant opening balance ----------------
export type MerchantOpeningInput = OpeningBalanceInput & { currency: string };

export async function syncMerchantOpeningBalance(merchantId: string, op: MerchantOpeningInput) {
  if (!merchantId) return;
  const date = op.date || todayISO();
  const currency = (op.currency || "EGP").trim() || "EGP";
  const debit = Math.max(0, Number(op.debit) || 0);
  const credit = Math.max(0, Number(op.credit) || 0);

  await supabase
    .from("merchant_cash_collections")
    .delete()
    .eq("merchant_id", merchantId)
    .eq("opening_currency", currency)
    .in("source_service_type", ["opening_debit", "opening_credit"] as any);

  const rows: any[] = [];
  // Statement column drives label rendering; use "رصيد سابق".
  // Balance formula in merchant statement:
  //   collections contribute delta = -amount
  // So:
  //   opening_debit (merchant owes us) => balance +debit  => amount = -debit
  //   opening_credit (we owe merchant) => balance -credit => amount = +credit
  if (debit > 0) {
    rows.push({
      merchant_id: merchantId,
      date,
      amount: -debit,
      note: op.note || null,
      statement: "رصيد سابق",
      source_service_type: "opening_debit",
      source_service_id: merchantId,
      opening_currency: currency,
    });
  }
  if (credit > 0) {
    rows.push({
      merchant_id: merchantId,
      date,
      amount: credit,
      note: op.note || null,
      statement: "رصيد سابق",
      source_service_type: "opening_credit",
      source_service_id: merchantId,
      opening_currency: currency,
    });
  }
  if (rows.length) {
    const { error } = await supabase.from("merchant_cash_collections").insert(rows as any);
    if (error) throw error;
  }
}

// ---------------- Currency supplier opening balance ----------------
export type CurrencySupplierOpeningInput = OpeningBalanceInput & { currency: string };

export async function syncCurrencySupplierOpeningBalance(
  supplierId: string,
  op: CurrencySupplierOpeningInput,
) {
  if (!supplierId) return;
  const date = op.date || todayISO();
  const currency = (op.currency || "EGP").trim() || "EGP";
  const debit = Math.max(0, Number(op.debit) || 0);
  const credit = Math.max(0, Number(op.credit) || 0);

  await supabase
    .from("currency_supplier_transactions" as any)
    .delete()
    .eq("supplier_id", supplierId)
    .eq("opening_currency", currency)
    .in("source_service_type", ["opening_debit", "opening_credit"] as any);

  const rows: any[] = [];
  if (debit > 0) {
    rows.push({
      supplier_id: supplierId,
      tx_date: date,
      tx_type: "رصيد سابق",
      bought_currency: currency,
      sold_currency: currency,
      bought_amount: debit,
      sold_amount: 0,
      exchange_rate: null,
      description: op.note || null,
      statement: "رصيد سابق",
      source_service_type: "opening_debit",
      source_service_id: supplierId,
      opening_currency: currency,
    });
  }
  if (credit > 0) {
    rows.push({
      supplier_id: supplierId,
      tx_date: date,
      tx_type: "رصيد سابق",
      bought_currency: currency,
      sold_currency: currency,
      bought_amount: 0,
      sold_amount: credit,
      exchange_rate: null,
      description: op.note || null,
      statement: "رصيد سابق",
      source_service_type: "opening_credit",
      source_service_id: supplierId,
      opening_currency: currency,
    });
  }
  if (rows.length) {
    const { error } = await supabase.from("currency_supplier_transactions" as any).insert(rows as any);
    if (error) throw error;
  }
}

// ---------------- Cash-box opening balance ----------------
export type CashBoxOpeningInput = {
  amount: number;
  date: string | null;
  note: string | null;
};

/**
 * Sets a cash-box opening balance. Adjusts cash_boxes.balance by the delta
 * against the previously recorded opening_balance so re-entering doesn't
 * double-count. Also records a marker row in usd_treasury_transactions
 * (source_service_type='opening') so it appears in treasury statements.
 */
export async function syncCashBoxOpeningBalance(cashBoxId: string, op: CashBoxOpeningInput) {
  if (!cashBoxId) return;
  const amount = Number(op.amount) || 0;
  const date = op.date || todayISO();

  // Read current opening_balance + balance to compute the delta.
  const { data: box, error: readErr } = await supabase
    .from("cash_boxes")
    .select("id, balance, opening_balance, currency")
    .eq("id", cashBoxId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!box) throw new Error("الخزينة غير موجودة");

  const prevOpening = Number((box as any).opening_balance || 0);
  const prevBalance = Number((box as any).balance || 0);
  const delta = amount - prevOpening;
  const newBalance = prevBalance + delta;

  const { error: updErr } = await supabase
    .from("cash_boxes")
    .update({
      opening_balance: amount,
      opening_date: date,
      opening_note: op.note || null,
      balance: newBalance,
    } as any)
    .eq("id", cashBoxId);
  if (updErr) throw updErr;

  // Marker row in usd_treasury_transactions for the treasury statement.
  await supabase
    .from("usd_treasury_transactions")
    .delete()
    .eq("cash_box_id", cashBoxId)
    .eq("source_service_type", "opening");

  if (amount !== 0) {
    const { error: insErr } = await supabase.from("usd_treasury_transactions").insert({
      cash_box_id: cashBoxId,
      date,
      type: "opening",
      usd_amount: 0,
      egp_amount: amount,
      exchange_rate: null,
      note: op.note || null,
      statement: "رصيد افتتاحي",
      source_service_type: "opening",
      source_service_id: cashBoxId,
    } as any);
    if (insErr) throw insErr;
  }
}

