/**
 * Financial Engine — cancel / restore financial transactions.
 *
 * Soft-cancel only: sets `cancelled_at`, `cancelled_by`, `cancel_reason` on
 * the parent row AND on all related `payment_splits`. The `payment_splits`
 * database trigger automatically reverses the cash-box balance for cancelled
 * rows (they contribute 0). Statements & balance guards filter cancelled
 * rows out of aggregates. Every action is written to `financial_audit_log`.
 *
 * NEVER mutate financial rows directly from UI — always go through this.
 */

import { supabase } from "@/integrations/supabase/client";

export type CancellableTable =
  | "transactions"
  | "company_transactions"
  | "currency_supplier_transactions"
  | "expense_deductions"
  | "usd_treasury_transactions"
  | "merchant_cash_collections"
  | "payment_splits";

const PAYMENT_SPLIT_PARENTS: ReadonlySet<CancellableTable> = new Set([
  "transactions",
  "company_transactions",
  "currency_supplier_transactions",
  "expense_deductions",
  "usd_treasury_transactions",
  "merchant_cash_collections",
]);

function entityFieldsFor(table: CancellableTable, row: any) {
  const pick = (k: string) => (row && row[k] != null ? String(row[k]) : null);
  switch (table) {
    case "transactions":
      return { entity_type: "agent", entity_id: pick("agent_id"), reference_no: pick("date") };
    case "company_transactions":
      return { entity_type: "company", entity_id: pick("company_id"), reference_no: pick("date") };
    case "currency_supplier_transactions":
      return { entity_type: "currency_supplier", entity_id: pick("supplier_id"), reference_no: pick("date") };
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

export async function cancelFinancialTransaction(args: {
  table: CancellableTable;
  id: string;
  reason: string;
}): Promise<void> {
  const { table, id, reason } = args;
  const trimmed = (reason || "").trim();
  if (!trimmed) throw new Error("سبب الإلغاء مطلوب");

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("يجب تسجيل الدخول لإلغاء الحركة");

  // 1. Read parent row (before value)
  const { data: before, error: readErr } = await supabase
    .from(table as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!before) throw new Error("الحركة غير موجودة");
  if ((before as any).cancelled_at) throw new Error("الحركة ملغاة بالفعل");

  const nowIso = new Date().toISOString();
  const patch = { cancelled_at: nowIso, cancelled_by: userId, cancel_reason: trimmed };

  // 2. Cancel parent
  const { error: updErr } = await supabase
    .from(table as any)
    .update(patch)
    .eq("id", id);
  if (updErr) throw updErr;

  // 3. Cancel related payment_splits (their trigger reverses cash-box balance)
  if (PAYMENT_SPLIT_PARENTS.has(table)) {
    const { error: splitErr } = await supabase
      .from("payment_splits")
      .update(patch)
      .eq("source_table", table)
      .eq("source_id", id)
      .is("cancelled_at", null);
    if (splitErr) throw splitErr;
  }

  // 4. Audit log
  const meta = entityFieldsFor(table, before);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "cancel",
    reason: trimmed,
    performed_by: userId,
    before_value: before as any,
    after_value: { ...(before as any), ...patch } as any,
    ...meta,
  });
}

export async function restoreFinancialTransaction(args: {
  table: CancellableTable;
  id: string;
  reason: string;
}): Promise<void> {
  const { table, id, reason } = args;
  const trimmed = (reason || "").trim();
  if (!trimmed) throw new Error("سبب إعادة التفعيل مطلوب");

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("يجب تسجيل الدخول");

  const { data: before } = await supabase
    .from(table as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!before) throw new Error("الحركة غير موجودة");

  const patch = { cancelled_at: null, cancelled_by: null, cancel_reason: null };
  const { error: updErr } = await supabase
    .from(table as any)
    .update(patch)
    .eq("id", id);
  if (updErr) throw updErr;

  if (PAYMENT_SPLIT_PARENTS.has(table)) {
    await supabase
      .from("payment_splits")
      .update(patch)
      .eq("source_table", table)
      .eq("source_id", id);
  }

  const meta = entityFieldsFor(table, before);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "restore",
    reason: trimmed,
    performed_by: userId,
    before_value: before as any,
    after_value: { ...(before as any), ...patch } as any,
    ...meta,
  });
}
