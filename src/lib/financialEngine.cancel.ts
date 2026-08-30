/**
 * Financial Engine — atomic cancel / restore financial transactions.
 *
 * Parent row + every related payment_split are changed by ONE PostgreSQL RPC.
 * The payment_splits balance trigger therefore runs inside the same transaction:
 * if any parent/split/trigger update fails, PostgreSQL rolls everything back.
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

function mutationErrorMessage(error: any, rpcName: string): string {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "");
  const lower = message.toLowerCase();
  const missingRpc = code === "PGRST202"
    || (lower.includes(rpcName.toLowerCase()) && (lower.includes("could not find") || lower.includes("schema cache")));
  if (missingRpc) {
    return "تم إيقاف العملية بدون تغيير أي جزء: تحديث الحركات المالية الذرية غير مُطبق على قاعدة البيانات بعد.";
  }
  return message || "تعذر تنفيذ التغيير المالي";
}

async function changeCancelState(args: {
  table: CancellableTable;
  id: string;
  cancel: boolean;
  reason: string;
}) {
  const trimmed = (args.reason || "").trim();
  if (!trimmed) throw new Error(args.cancel ? "سبب الإلغاء مطلوب" : "سبب إعادة التفعيل مطلوب");

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("يجب تسجيل الدخول");

  const { data, error } = await (supabase as any).rpc("set_financial_cancel_state_atomic", {
    p_table: args.table,
    p_id: args.id,
    p_cancel: args.cancel,
    p_reason: trimmed,
  });
  if (error) throw new Error(mutationErrorMessage(error, "set_financial_cancel_state_atomic"));
  if (!data || data.ok !== true) throw new Error(data?.error || "تعذر تأكيد التغيير المالي");

  // Audit is intentionally outside the financial transaction: failure to write
  // a diagnostic log must never turn a committed financial change into a false
  // UI failure. The money/parent state itself is already fully atomic.
  if (!data.reused) {
    try {
      const before = data.before || {};
      const after = data.after || before;
      const meta = entityFieldsFor(args.table, before);
      await supabase.from("financial_audit_log").insert({
        table_name: args.table,
        record_id: args.id,
        action: args.cancel ? "cancel" : "restore",
        reason: trimmed,
        performed_by: userId,
        before_value: before as any,
        after_value: after as any,
        ...meta,
      } as any);
    } catch (auditError) {
      console.warn("[financial-audit] cancel/restore log failed", auditError);
    }
  }
}

export async function cancelFinancialTransaction(args: {
  table: CancellableTable;
  id: string;
  reason: string;
}): Promise<void> {
  await changeCancelState({ ...args, cancel: true });
}

export async function restoreFinancialTransaction(args: {
  table: CancellableTable;
  id: string;
  reason: string;
}): Promise<void> {
  await changeCancelState({ ...args, cancel: false });
}
