/**
 * Financial Engine — cancel / restore financial transactions.
 *
 * Accounting rule:
 * - parent financial rows are soft-cancelled,
 * - related payment_splits are soft-cancelled with the SAME cancellation stamp,
 * - apply_payment_split_to_cash_box() removes/reapplies their treasury effect on
 *   UPDATE because cancelled_at changes active amount -> 0 (and back on restore),
 * - cash-box balances are verified after every reversal/re-application,
 * - compensating rollback restores the previous state if a later step fails.
 *
 * This preserves every historical payment_split row and prevents a parent row
 * from being reported as cancelled while its treasury effect is still active.
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

const EPSILON = 0.0001;

type SplitRow = Record<string, any> & {
  id: string;
  cash_box_id?: string | null;
  amount?: number | string | null;
  direction?: "in" | "out" | string | null;
  cancelled_at?: string | null;
};

function entityFieldsFor(table: CancellableTable, row: any) {
  const pick = (k: string) => (row && row[k] != null ? String(row[k]) : null);
  switch (table) {
    case "transactions":
      return { entity_type: "agent", entity_id: pick("agent_id"), reference_no: pick("date") };
    case "company_transactions":
      return { entity_type: "company", entity_id: pick("company_id"), reference_no: pick("date") };
    case "currency_supplier_transactions":
      return {
        entity_type: "currency_supplier",
        entity_id: pick("supplier_id"),
        reference_no: pick("tx_date") || pick("date"),
      };
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

function expectedBalanceDelta(rows: SplitRow[], mode: "cancel" | "restore") {
  const map = new Map<string, number>();
  for (const row of rows) {
    const boxId = row.cash_box_id ? String(row.cash_box_id) : "";
    if (!boxId) continue;
    const amount = Number(row.amount || 0);
    if (!(amount > 0)) continue;
    const activeEffect = row.direction === "out" ? -amount : amount;
    const delta = mode === "cancel" ? -activeEffect : activeEffect;
    map.set(boxId, (map.get(boxId) || 0) + delta);
  }
  return map;
}

async function cashBoxBalances(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from("cash_boxes")
    .select("id,balance")
    .in("id", ids);
  if (error) throw error;
  return new Map(((data as any[]) || []).map((row) => [String(row.id), Number(row.balance || 0)]));
}

async function verifyTreasuryEffect(
  before: Map<string, number>,
  expectedDelta: Map<string, number>,
): Promise<void> {
  if (!expectedDelta.size) return;
  const ids = Array.from(expectedDelta.keys());
  const after = await cashBoxBalances(ids);
  const failures: string[] = [];

  for (const id of ids) {
    const previous = before.get(id);
    const current = after.get(id);
    if (previous == null || current == null) {
      failures.push(`${id}: تعذر قراءة رصيد الخزنة`);
      continue;
    }
    const expected = previous + (expectedDelta.get(id) || 0);
    if (Math.abs(current - expected) > EPSILON) {
      failures.push(`${id}: المتوقع ${expected} والحالي ${current}`);
    }
  }

  if (failures.length) {
    throw new Error(`فشل تحديث أثر الحركة على الخزينة: ${failures.join(" | ")}`);
  }
}

async function loadSplits(
  table: CancellableTable,
  id: string,
  state: "active" | "cancelled",
): Promise<SplitRow[]> {
  if (table === "payment_splits") {
    let query = supabase.from("payment_splits").select("*").eq("id", id);
    query = state === "active" ? query.is("cancelled_at", null) : query.not("cancelled_at", "is", null);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data ? [data as SplitRow] : [];
  }

  if (!PAYMENT_SPLIT_PARENTS.has(table)) return [];
  let query = supabase
    .from("payment_splits")
    .select("*")
    .eq("source_table", table)
    .eq("source_id", id);
  query = state === "active" ? query.is("cancelled_at", null) : query.not("cancelled_at", "is", null);
  const { data, error } = await query;
  if (error) throw error;
  return ((data as any[]) || []) as SplitRow[];
}

async function setSplitsCancelledAndVerify(
  rows: SplitRow[],
  patch: { cancelled_at: string; cancelled_by: string; cancel_reason: string },
): Promise<void> {
  if (!rows.length) return;
  const delta = expectedBalanceDelta(rows, "cancel");
  const beforeBalances = await cashBoxBalances(Array.from(delta.keys()));
  const ids = rows.map((row) => row.id);

  const { error } = await supabase
    .from("payment_splits")
    .update(patch)
    .in("id", ids)
    .is("cancelled_at", null);
  if (error) throw error;

  try {
    await verifyTreasuryEffect(beforeBalances, delta);
  } catch (error) {
    // Compensating rollback. UPDATE trigger reapplies the original treasury effect.
    await supabase
      .from("payment_splits")
      .update({ cancelled_at: null, cancelled_by: null, cancel_reason: null })
      .in("id", ids);
    throw error;
  }
}

async function restoreSplitsAndVerify(rows: SplitRow[]): Promise<void> {
  if (!rows.length) return;
  const delta = expectedBalanceDelta(rows, "restore");
  const beforeBalances = await cashBoxBalances(Array.from(delta.keys()));
  const ids = rows.map((row) => row.id);

  const { error } = await supabase
    .from("payment_splits")
    .update({ cancelled_at: null, cancelled_by: null, cancel_reason: null })
    .in("id", ids)
    .not("cancelled_at", "is", null);
  if (error) throw error;

  try {
    await verifyTreasuryEffect(beforeBalances, delta);
  } catch (error) {
    const stamp = rows[0]?.cancelled_at || new Date().toISOString();
    await supabase
      .from("payment_splits")
      .update({
        cancelled_at: stamp,
        cancelled_by: rows[0]?.cancelled_by ?? null,
        cancel_reason: rows[0]?.cancel_reason ?? "تعويض تلقائي بعد فشل إعادة التفعيل",
      } as any)
      .in("id", ids);
    throw error;
  }
}

async function rollbackCancellation(rows: SplitRow[]): Promise<void> {
  if (!rows.length) return;
  await supabase
    .from("payment_splits")
    .update({ cancelled_at: null, cancelled_by: null, cancel_reason: null })
    .in("id", rows.map((row) => row.id));
}

async function rollbackRestore(
  rows: SplitRow[],
  fallback: { cancelled_at: string; cancelled_by: string | null; cancel_reason: string | null },
): Promise<void> {
  if (!rows.length) return;
  await supabase
    .from("payment_splits")
    .update(fallback as any)
    .in("id", rows.map((row) => row.id));
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

  const { data: before, error: readErr } = await supabase
    .from(table as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!before) throw new Error("الحركة غير موجودة");
  if ((before as any).cancelled_at) throw new Error("الحركة ملغاة بالفعل");

  const activeSplits = await loadSplits(table, id, "active");
  const nowIso = new Date().toISOString();
  const patch = { cancelled_at: nowIso, cancelled_by: userId, cancel_reason: trimmed };

  // Cancel treasury rows first. If this fails, the parent remains active.
  await setSplitsCancelledAndVerify(activeSplits, patch);

  if (table !== "payment_splits") {
    const { error: updErr } = await supabase.from(table as any).update(patch).eq("id", id);
    if (updErr) {
      await rollbackCancellation(activeSplits);
      throw updErr;
    }

    // Final consistency gate: after parent cancellation no active split may remain.
    const leftovers = await loadSplits(table, id, "active");
    if (leftovers.length) {
      await supabase.from(table as any).update({ cancelled_at: null, cancelled_by: null, cancel_reason: null }).eq("id", id);
      await rollbackCancellation(activeSplits);
      throw new Error("تعذر إلغاء جميع قيود الخزينة المرتبطة بالحركة؛ لم يتم اعتماد الإلغاء");
    }
  }

  const meta = entityFieldsFor(table, before);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "cancel",
    reason: trimmed,
    performed_by: userId,
    before_value: { ...(before as any), related_payment_splits: activeSplits } as any,
    after_value: { ...(before as any), ...patch, related_payment_splits: activeSplits.map((s) => ({ ...s, ...patch })) } as any,
    ...meta,
  } as any);
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

  const { data: before, error: readErr } = await supabase
    .from(table as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!before) throw new Error("الحركة غير موجودة");
  if (!(before as any).cancelled_at) throw new Error("الحركة مفعلة بالفعل");

  const cancelledSplits = await loadSplits(table, id, "cancelled");
  const originalCancel = {
    cancelled_at: String((before as any).cancelled_at),
    cancelled_by: (before as any).cancelled_by ?? null,
    cancel_reason: (before as any).cancel_reason ?? null,
  };

  await restoreSplitsAndVerify(cancelledSplits);

  const clearPatch = { cancelled_at: null, cancelled_by: null, cancel_reason: null };
  if (table !== "payment_splits") {
    const { error: updErr } = await supabase.from(table as any).update(clearPatch).eq("id", id);
    if (updErr) {
      await rollbackRestore(cancelledSplits, originalCancel);
      throw updErr;
    }

    // Final consistency gate: restored parent must not retain cancelled splits.
    const leftovers = await loadSplits(table, id, "cancelled");
    if (leftovers.length) {
      await supabase.from(table as any).update(originalCancel as any).eq("id", id);
      await rollbackRestore(cancelledSplits, originalCancel);
      throw new Error("تعذر إعادة تفعيل جميع قيود الخزينة المرتبطة بالحركة؛ لم يتم اعتماد الاسترجاع");
    }
  }

  const meta = entityFieldsFor(table, before);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "restore",
    reason: trimmed,
    performed_by: userId,
    before_value: { ...(before as any), related_payment_splits: cancelledSplits } as any,
    after_value: { ...(before as any), ...clearPatch, related_payment_splits: cancelledSplits.map((s) => ({ ...s, ...clearPatch })) } as any,
    ...meta,
  } as any);
}
