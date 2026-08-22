/**
 * Financial Engine — cancel / restore financial transactions.
 *
 * Cancellation is accounting-safe:
 * - parent rows are soft-cancelled (audit/history is preserved),
 * - related payment_splits are snapshotted in financial_audit_log then deleted,
 *   so the existing payment_splits DELETE trigger reverses cash-box balances,
 * - treasury balances are verified after the reversal,
 * - restore recreates the exact snapshotted splits so the INSERT trigger reapplies
 *   the original treasury effect.
 *
 * No financial row may be reported as cancelled successfully while its treasury
 * impact is still active.
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

type SplitSnapshot = Record<string, any> & {
  id: string;
  cash_box_id?: string | null;
  amount?: number | string | null;
  direction?: "in" | "out" | string | null;
};

function entityFieldsFor(table: CancellableTable, row: any) {
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

function activeSplitPayload(rows: SplitSnapshot[]): SplitSnapshot[] {
  return rows.map((row) => ({
    ...row,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
  }));
}

function expectedBalanceDelta(rows: SplitSnapshot[], mode: "delete" | "insert") {
  const map = new Map<string, number>();
  for (const row of rows) {
    const boxId = row.cash_box_id ? String(row.cash_box_id) : "";
    if (!boxId) continue; // merchant wallet / non-company cash source
    const amount = Number(row.amount || 0);
    if (!(amount > 0)) continue;
    const originalEffect = row.direction === "out" ? -amount : amount;
    const delta = mode === "delete" ? -originalEffect : originalEffect;
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
    throw new Error(`فشل عكس أثر الحركة على الخزينة: ${failures.join(" | ")}`);
  }
}

async function relatedActiveSplits(table: CancellableTable, id: string): Promise<SplitSnapshot[]> {
  if (table === "payment_splits") {
    const { data, error } = await supabase.from("payment_splits").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? [data as SplitSnapshot] : [];
  }
  if (!PAYMENT_SPLIT_PARENTS.has(table)) return [];
  const { data, error } = await supabase
    .from("payment_splits")
    .select("*")
    .eq("source_table", table)
    .eq("source_id", id)
    .is("cancelled_at", null);
  if (error) throw error;
  return ((data as any[]) || []) as SplitSnapshot[];
}

async function deleteSplitsAndVerify(rows: SplitSnapshot[]): Promise<void> {
  if (!rows.length) return;
  const delta = expectedBalanceDelta(rows, "delete");
  const before = await cashBoxBalances(Array.from(delta.keys()));
  const ids = rows.map((row) => row.id);
  const { error } = await supabase.from("payment_splits").delete().in("id", ids);
  if (error) throw error;
  try {
    await verifyTreasuryEffect(before, delta);
  } catch (error) {
    // Compensating rollback: restore the exact rows if treasury verification fails.
    await supabase.from("payment_splits").insert(activeSplitPayload(rows) as any);
    throw error;
  }
}

async function insertSplitsAndVerify(rows: SplitSnapshot[]): Promise<void> {
  if (!rows.length) return;
  const payload = activeSplitPayload(rows);
  const delta = expectedBalanceDelta(payload, "insert");
  const before = await cashBoxBalances(Array.from(delta.keys()));
  const { error } = await supabase.from("payment_splits").insert(payload as any);
  if (error) throw error;
  try {
    await verifyTreasuryEffect(before, delta);
  } catch (error) {
    await supabase.from("payment_splits").delete().in("id", payload.map((row) => row.id));
    throw error;
  }
}

async function latestCancelSnapshot(table: CancellableTable, id: string): Promise<SplitSnapshot[]> {
  const { data, error } = await supabase
    .from("financial_audit_log")
    .select("before_value")
    .eq("table_name", table)
    .eq("record_id", id)
    .eq("action", "cancel")
    .order("performed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const beforeValue = (data as any)?.before_value;
  const rows = beforeValue?.related_payment_splits;
  return Array.isArray(rows) ? (rows as SplitSnapshot[]) : [];
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

  const splits = await relatedActiveSplits(table, id);
  const nowIso = new Date().toISOString();
  const patch = { cancelled_at: nowIso, cancelled_by: userId, cancel_reason: trimmed };

  // First reverse the actual treasury effect. If this fails, the parent stays active.
  await deleteSplitsAndVerify(splits);

  if (table !== "payment_splits") {
    const { error: updErr } = await supabase.from(table as any).update(patch).eq("id", id);
    if (updErr) {
      // Restore financial effect if soft-cancelling the parent failed.
      await insertSplitsAndVerify(splits);
      throw updErr;
    }
  }

  const meta = entityFieldsFor(table, before);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "cancel",
    reason: trimmed,
    performed_by: userId,
    before_value: { ...(before as any), related_payment_splits: splits } as any,
    after_value: table === "payment_splits"
      ? { ...(before as any), ...patch, deleted_from_payment_splits: true }
      : { ...(before as any), ...patch, related_payment_splits: [] },
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

  // payment_splits are physically removed by the new cancellation flow, so its
  // restore source is the audit snapshot. Parent rows remain soft-cancelled.
  let before: any = null;
  if (table !== "payment_splits") {
    const { data, error } = await supabase.from(table as any).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    before = data;
    if (!before) throw new Error("الحركة غير موجودة");
    if (!(before as any).cancelled_at) throw new Error("الحركة مفعلة بالفعل");
  }

  const snapshot = await latestCancelSnapshot(table, id);

  if (snapshot.length) {
    await insertSplitsAndVerify(snapshot);
  } else if (table !== "payment_splits" && PAYMENT_SPLIT_PARENTS.has(table)) {
    // Legacy soft-cancel fallback: old cancellations may still have cancelled
    // payment_splits in place because the previous flow never deleted them.
    // Re-activate those rows without creating duplicates.
    const { error } = await supabase
      .from("payment_splits")
      .update({ cancelled_at: null, cancelled_by: null, cancel_reason: null })
      .eq("source_table", table)
      .eq("source_id", id);
    if (error) throw error;
  } else if (table === "payment_splits") {
    throw new Error("لا توجد نسخة محفوظة من حركة الدفع لإعادتها");
  }

  const patch = { cancelled_at: null, cancelled_by: null, cancel_reason: null };
  if (table !== "payment_splits") {
    const { error: updErr } = await supabase.from(table as any).update(patch).eq("id", id);
    if (updErr) {
      if (snapshot.length) await deleteSplitsAndVerify(snapshot);
      throw updErr;
    }
  }

  const auditSource = before ?? snapshot[0] ?? {};
  const meta = entityFieldsFor(table, auditSource);
  await supabase.from("financial_audit_log").insert({
    table_name: table,
    record_id: id,
    action: "restore",
    reason: trimmed,
    performed_by: userId,
    before_value: before ?? { related_payment_splits: snapshot },
    after_value: table === "payment_splits"
      ? { ...(snapshot[0] || {}), restored_to_payment_splits: true }
      : { ...(before as any), ...patch, related_payment_splits: snapshot },
    ...meta,
  } as any);
}
