/**
 * Financial Engine — atomic edit financial transactions.
 *
 * Reads/validation happen first, then every financial WRITE (parent + all
 * payment_splits) is sent to one PostgreSQL RPC. The payment_splits trigger
 * updates cash_boxes inside that same DB transaction, so an edit is all-or-none.
 */

import { supabase } from "@/integrations/supabase/client";
import { checkOutflowAllowed } from "@/lib/financialEngine";
import type { CancellableTable } from "@/lib/financialEngine.cancel";

export type EditableTable = CancellableTable;

export type EditPatch = {
  amount?: number;
  date?: string;
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

function parentAmountPatch(table: EditableTable, before: any, newAmount: number): Record<string, unknown> {
  const oldTotal = pickOldTotal(table, before);
  const ratio = oldTotal > 0 ? newAmount / oldTotal : 0;
  switch (table) {
    case "transactions":
    case "company_transactions": {
      const cols = [
        "instapay_amount", "cash_amount", "mobile_cash_amount", "mobile_cash_net_amount",
        "arabic_tourism_cash_amount", "arabic_tourism_cash_net_amount",
        "merchant_cash_amount", "merchant_cash_net_amount", "merchant_cash_physical_amount",
        "usd_amount",
      ];
      const patch: Record<string, unknown> = { paid: newAmount, total_paid: newAmount };
      for (const c of cols) {
        const v = Number((before as any)[c]) || 0;
        if (v > 0) patch[c] = oldTotal > 0 ? Math.round(v * ratio * 100) / 100 : 0;
      }
      return patch;
    }
    case "currency_supplier_transactions": {
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
      return {};
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
    if (table === "currency_supplier_transactions") out.tx_date = patch.date;
    else if (table === "expense_deductions") out.deduction_date = patch.date;
    else if (table !== "payment_splits") out.date = patch.date;
  }
  if (patch.note !== undefined) {
    if (table === "currency_supplier_transactions") out.description = patch.note ?? null;
    else if (table !== "payment_splits") out.note = patch.note ?? null;
  }
  if (patch.statement !== undefined && table !== "payment_splits") out.statement = patch.statement ?? null;
  return out;
}

function mutationErrorMessage(error: any): string {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "");
  const lower = message.toLowerCase();
  const missingRpc = code === "PGRST202"
    || (lower.includes("update_financial_transaction_atomic") && (lower.includes("could not find") || lower.includes("schema cache")));
  if (missingRpc) {
    return "تم إيقاف التعديل بدون تغيير أي جزء: تحديث الحركات المالية الذرية غير مُطبق على قاعدة البيانات بعد.";
  }
  return message || "تعذر تعديل الحركة المالية";
}

function scaleSplitPatch(split: any, ratio: number) {
  const scale = (v: any) => {
    const n = Number(v) || 0;
    return n > 0 ? Math.round(n * ratio * 100) / 100 : n;
  };
  return {
    id: split.id,
    amount: scale(split.amount),
    gross_amount: scale(split.gross_amount ?? split.amount),
    merchant_commission_amount: scale(split.merchant_commission_amount),
    net_amount: scale(split.net_amount ?? split.amount),
    egp_equivalent: scale(split.egp_equivalent ?? split.amount),
  };
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

  const { data: before, error: readErr } = await supabase
    .from(table as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!before) throw new Error("الحركة غير موجودة");
  if ((before as any).cancelled_at) throw new Error("لا يمكن تعديل حركة ملغاة — قم بإعادة التفعيل أولاً");

  let currentSplits: any[] = [];
  if (PAYMENT_SPLIT_PARENTS.has(table)) {
    const { data: sp, error: splitReadError } = await supabase
      .from("payment_splits")
      .select("*")
      .eq("source_table", table)
      .eq("source_id", id)
      .is("cancelled_at", null);
    if (splitReadError) throw splitReadError;
    currentSplits = sp || [];
  }

  const oldTotal = pickOldTotal(table, before);
  const newAmount = patch.amount !== undefined ? Number(patch.amount) : oldTotal;
  const amountChanged = patch.amount !== undefined && newAmount !== oldTotal;
  if (amountChanged && !(newAmount > 0)) throw new Error("المبلغ يجب أن يكون أكبر من صفر");

  // Existing business validation remains before the transaction. The actual
  // parent/split writes themselves are atomic even if validation or network
  // conditions change afterwards.
  if (amountChanged && newAmount > oldTotal && currentSplits.length > 0) {
    const delta = newAmount - oldTotal;
    for (const s of currentSplits) {
      if (s.direction !== "out" || !s.cash_box_id) continue;
      const share = oldTotal > 0 ? (Number(s.amount) / oldTotal) * delta : delta;
      if (share > 0) {
        const err = await checkOutflowAllowed(s.cash_box_id, share, "الخزينة");
        if (err) throw new Error(err);
      }
    }
  }

  const parentPatch: Record<string, unknown> = table === "payment_splits"
    ? {}
    : { ...metaPatchFor(table, patch) };
  if (amountChanged && table !== "payment_splits") {
    Object.assign(parentPatch, parentAmountPatch(table, before, newAmount));
  }

  let splitPatches: Record<string, unknown>[] = [];
  if (amountChanged && table === "payment_splits") {
    const s = before as any;
    const ratio = oldTotal > 0 ? newAmount / oldTotal : 1;
    splitPatches = [{
      id,
      amount: newAmount,
      gross_amount: newAmount,
      merchant_commission_amount: (() => {
        const n = Number(s.merchant_commission_amount) || 0;
        return n > 0 ? Math.round(n * ratio * 100) / 100 : n;
      })(),
      net_amount: newAmount,
      egp_equivalent: s.currency === "EGP" ? newAmount : newAmount * (Number(s.exchange_rate) || 1),
    }];
  } else if (amountChanged && currentSplits.length > 0 && oldTotal > 0) {
    const ratio = newAmount / oldTotal;
    splitPatches = currentSplits.map((s) => scaleSplitPatch(s, ratio));
  }

  const { data, error } = await (supabase as any).rpc("update_financial_transaction_atomic", {
    p_table: table,
    p_id: id,
    p_parent_patch: parentPatch,
    p_split_patches: splitPatches,
  });
  if (error) throw new Error(mutationErrorMessage(error));
  if (!data || data.ok !== true) throw new Error(data?.error || "تعذر تأكيد تعديل الحركة المالية");

  try {
    const meta = entityFieldsFor(table, data.before || before);
    await supabase.from("financial_audit_log").insert({
      table_name: table,
      record_id: id,
      action: "edit",
      reason: trimmedReason,
      performed_by: userId,
      before_value: (data.before || before) as any,
      after_value: (data.after || before) as any,
      ...meta,
    });
  } catch (auditError) {
    console.warn("[financial-audit] edit log failed", auditError);
  }
}
