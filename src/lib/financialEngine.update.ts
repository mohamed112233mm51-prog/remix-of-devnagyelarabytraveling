/**
 * Financial Engine — update / edit financial transactions.
 *
 * Strategy: Void + Re-post (safest, mirrors cancel logic).
 *  1. Read parent row + related payment_splits (before value).
 *  2. Validate: if amount is changing AND the direction is `out`, run
 *     `checkOutflowAllowed` on the *net* new amount against the cash box
 *     balance AFTER virtually reversing the old splits.
 *  3. Delete the existing payment_splits (trigger reverses cash-box balance).
 *  4. Re-insert the new payment_splits, preserving method/currency/cash_box
 *     but scaling amounts to match the new total (or, in the single-split
 *     case, using the new amount directly). Trigger re-applies balance.
 *  5. Patch the parent row's amount/metadata columns to match.
 *  6. Write audit log with action='edit', before/after JSON, reason.
 *
 * The dialog restricts editing to single-split rows for amount changes.
 * Multi-split rows can only edit metadata (date / statement / note).
 */

import { supabase } from "@/integrations/supabase/client";
import { checkOutflowAllowed } from "@/lib/financialEngine";
import type { CancellableTable } from "@/lib/financialEngine.cancel";

export type EditableTable = CancellableTable;

export type EditPatch = {
  amount?: number;          // new total amount (parent-level)
  date?: string;            // YYYY-MM-DD
  statement?: string | null;
  note?: string | null;
};

const PAYMENT_SPLIT_PARENTS: ReadonlySet<EditableTable> = new Set([
  "transactions",
  "company_transactions",
  "currency_supplier_transactions",
  "expense_deductions",
  "usd_treasury_transactions",
  "merchant_cash_collections",
]);

function entityFieldsFor(table: EditableTable, row: any) {
  const pick = (k: string) => (row && row[k] != null ? String(row[k]) : null);
  switch (table) {
    case "transactions":
      return { entity_type: "agent", entity_id: pick("agent_id"), reference_no: pick("date") };
    case "company_transactions":
      return { entity_type: "company", entity_id: pick("company_id"), reference_no: pick("date") };
    case "currency_supplier_transactions":
      return { entity_type: "currency_supplier", entity_id: pick("supplier_id"), reference_no: pick("tx_date") || pick("date") };
    case "merchant_cash_collections":
      return { entity_type: "merchant", entity_id: pick("merchant_id"), reference_no: pick("date") };
    case "usd_treasury_transactions":
      return { entity_type: "usd_treasury", entity_id: null, reference_no: pick("date") };
    case "expense_deductions":
      return { entity_type: "expense", entity_id: pick("expense_id"), reference_no: pick("deduction_date") };
    case "payment_splits":
      return { entity_type: "payment_split", entity_id: pick("cash_box_id"), reference_no: null };
  }
}

/** map (table, newAmount) → parent update patch that keeps totals coherent. */
function parentAmountPatch(table: EditableTable, before: any, newAmount: number): Record<string, unknown> {
  const oldTotal = pickOldTotal(table, before);
  const ratio = oldTotal > 0 ? newAmount / oldTotal : 0;
  switch (table) {
    case "transactions":
    case "company_transactions": {
      // scale all method-split columns by ratio so per-method totals stay proportional
      const cols = [
        "instapay_amount", "cash_amount", "mobile_cash_amount", "mobile_cash_net_amount",
        "arabic_tourism_cash_amount", "arabic_tourism_cash_net_amount",
        "merchant_cash_amount", "merchant_cash_net_amount", "merchant_cash_physical_amount",
        "usd_amount",
      ];
      const patch: Record<string, unknown> = {
        paid: newAmount,
        total_paid: newAmount,
      };
      for (const c of cols) {
        const v = Number((before as any)[c]) || 0;
        if (v > 0) patch[c] = oldTotal > 0 ? Math.round(v * ratio * 100) / 100 : 0;
      }
      return patch;
    }
    case "currency_supplier_transactions": {
      // adjust whichever leg is non-zero (bought or sold)
      const patch: Record<string, unknown> = {};
      if (Number(before.bought_amount) > 0) patch.bought_amount = newAmount;
      else patch.sold_amount = newAmount;
      return patch;
    }
    case "usd_treasury_transactions": {
      const patch: Record<string, unknown> = {};
      if (Number(before.usd_amount) > 0) patch.usd_amount = newAmount;
      else patch.egp_amount = newAmount;
      return patch;
    }
    case "expense_deductions":
      return Number(before.amount) > 0 ? { amount: newAmount } : { usd_amount: newAmount };
    case "merchant_cash_collections":
      return { amount: newAmount };
    case "payment_splits":
      return {}; // handled directly on the split row
  }
}

function pickOldTotal(table: EditableTable, row: any): number {
  const n = (v: any) => Number(v) || 0;
  switch (table) {
    case "transactions":
    case "company_transactions":
      return (
        n(row.total_paid) ||
        n(row.paid) ||
        n(row.cash_amount) + n(row.instapay_amount) + n(row.mobile_cash_amount) +
          n(row.merchant_cash_amount) + n(row.arabic_tourism_cash_amount) + n(row.usd_amount)
      );
    case "currency_supplier_transactions":
      return n(row.bought_amount) || n(row.sold_amount);
    case "usd_treasury_transactions":
      return n(row.usd_amount) || n(row.egp_amount);
    case "expense_deductions":
      return n(row.amount) || n(row.usd_amount);
    case "merchant_cash_collections":
      return n(row.amount);
    case "payment_splits":
      return n(row.net_amount) || n(row.gross_amount) || n(row.amount);
  }
}

function metaPatchFor(table: EditableTable, patch: EditPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.date !== undefined) {
    // pick the right date column per table
    if (table === "currency_supplier_transactions") out.tx_date = patch.date;
    else if (table === "expense_deductions") out.deduction_date = patch.date;
    else out.date = patch.date;
  }
  if (patch.note !== undefined) {
    if (table === "currency_supplier_transactions") out.description = patch.note ?? null;
    else out.note = patch.note ?? null;
  }
  if (patch.statement !== undefined) {
    out.statement = patch.statement ?? null;
  }
  return out;
}

export async function updateFinancialTransaction(args: {
  table: EditableTable;
  id: string;
  patch: EditPatch;
  reason: string;
}): Promise<void> {
  const { table, id, patch, reason } = args;
  const trimmedReason = (reason || "").trim();
  if (!trimmedReason) throw new Error("سبب التعديل مطلوب");

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("يجب تسجيل الدخول لتعديل الحركة");

  // 1) Read the parent (BEFORE)
  const { data: before, error: readErr } = await supabase
    .from(table as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!before) throw new Error("الحركة غير موجودة");
  if ((before as any).cancelled_at) throw new Error("لا يمكن تعديل حركة ملغاة — قم بإعادة التفعيل أولاً");

  // 2) Load current payment_splits (if any)
  let currentSplits: any[] = [];
  if (PAYMENT_SPLIT_PARENTS.has(table)) {
    const { data: sp } = await supabase
      .from("payment_splits")
      .select("*")
      .eq("source_table", table)
      .eq("source_id", id)
      .is("cancelled_at", null);
    currentSplits = sp || [];
  }

  const oldTotal = pickOldTotal(table, before);
  const newAmount = patch.amount !== undefined ? Number(patch.amount) : oldTotal;
  const amountChanged = patch.amount !== undefined && newAmount !== oldTotal;

  if (amountChanged && !(newAmount > 0)) {
    throw new Error("المبلغ يجب أن يكون أكبر من صفر");
  }

  // 3) Balance guard on outflow deltas (only if increasing an outflow)
  if (amountChanged && newAmount > oldTotal && currentSplits.length > 0) {
    const delta = newAmount - oldTotal;
    for (const s of currentSplits) {
      if (s.direction !== "out" || !s.cash_box_id) continue;
      const share = oldTotal > 0 ? (Number(s.amount) / oldTotal) * delta : delta;
      if (share > 0) {
        // balance already reflects existing splits; we only need to allow the extra share
        const err = await checkOutflowAllowed(s.cash_box_id, share, "الخزينة");
        if (err) throw new Error(err);
      }
    }
  }

  // 4) Re-post splits (delete + re-insert scaled)
  if (amountChanged && currentSplits.length > 0 && oldTotal > 0) {
    const ratio = newAmount / oldTotal;
    // delete old (trigger reverses balance)
    const oldIds = currentSplits.map((s) => s.id);
    const { error: delErr } = await supabase.from("payment_splits").delete().in("id", oldIds);
    if (delErr) throw delErr;

    // re-insert scaled
    const rows = currentSplits.map((s) => {
      const scale = (v: any) => {
        const n = Number(v) || 0;
        return n > 0 ? Math.round(n * ratio * 100) / 100 : n;
      };
      return {
        transaction_id: s.transaction_id,
        method: s.method,
        currency: s.currency,
        cash_box_id: s.cash_box_id,
        amount: scale(s.amount),
        direction: s.direction,
        source_table: s.source_table,
        source_id: s.source_id,
        gross_amount: scale(s.gross_amount ?? s.amount),
        merchant_commission_rate: s.merchant_commission_rate ?? 0,
        merchant_commission_amount: scale(s.merchant_commission_amount),
        net_amount: scale(s.net_amount ?? s.amount),
        exchange_rate: s.exchange_rate ?? 1,
        egp_equivalent: scale(s.egp_equivalent ?? s.amount),
      };
    });
    const { error: insErr } = await supabase.from("payment_splits").insert(rows);
    if (insErr) throw insErr;
  } else if (amountChanged && table === "payment_splits") {
    // direct edit on a single split
    const { error: dErr } = await supabase.from("payment_splits").delete().eq("id", id);
    if (dErr) throw dErr;
    const s = before as any;
    const ratio = oldTotal > 0 ? newAmount / oldTotal : 1;
    const scale = (v: any) => {
      const n = Number(v) || 0;
      return n > 0 ? Math.round(n * ratio * 100) / 100 : n;
    };
    const { error: iErr } = await supabase.from("payment_splits").insert({
      transaction_id: s.transaction_id,
      method: s.method,
      currency: s.currency,
      cash_box_id: s.cash_box_id,
      amount: newAmount,
      direction: s.direction,
      source_table: s.source_table,
      source_id: s.source_id,
      gross_amount: newAmount,
      merchant_commission_rate: s.merchant_commission_rate ?? 0,
      merchant_commission_amount: scale(s.merchant_commission_amount),
      net_amount: newAmount,
      exchange_rate: s.exchange_rate ?? 1,
      egp_equivalent: s.currency === "EGP" ? newAmount : newAmount * (Number(s.exchange_rate) || 1),
    } as any);
    if (iErr) throw iErr;
  }

  // 5) Patch parent (amount + metadata)
  if (table !== "payment_splits") {
    const parentPatch: Record<string, unknown> = { ...metaPatchFor(table, patch) };
    if (amountChanged) Object.assign(parentPatch, parentAmountPatch(table, before, newAmount));
    if (Object.keys(parentPatch).length > 0) {
      const { error: updErr } = await supabase
        .from(table as any)
        .update(parentPatch)
        .eq("id", id);
      if (updErr) throw updErr;
    }
  }

  // 6) After snapshot + audit
  const { data: after } = await supabase.from(table as any).select("*").eq("id", id).maybeSingle();
  const meta = entityFieldsFor(table, before);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "edit",
    reason: trimmedReason,
    performed_by: userId,
    before_value: before as any,
    after_value: (after ?? before) as any,
    ...meta,
  });
}
