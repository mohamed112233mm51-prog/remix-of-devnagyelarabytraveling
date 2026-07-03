/**
 * Central financial audit logger.
 *
 * All create/update/cancel/restore/delete of financial rows MUST go through
 * `logFinancialAudit` so `financial_audit_log` becomes the single source of
 * truth for tracking every financial change.
 *
 * `financialEngine.update` and `financialEngine.cancel` already insert into
 * `financial_audit_log` directly with the same shape — this helper wraps
 * that shape for CREATE hooks called from forms and posting pipelines.
 */

import { supabase } from "@/integrations/supabase/client";

export type AuditTable =
  | "transactions"
  | "company_transactions"
  | "currency_supplier_transactions"
  | "expense_deductions"
  | "usd_treasury_transactions"
  | "merchant_cash_collections"
  | "payment_splits";

export type AuditAction = "create" | "edit" | "cancel" | "restore" | "delete";

export function entityFieldsFor(table: AuditTable, row: any) {
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

export async function logFinancialAudit(args: {
  table: AuditTable;
  recordId: string;
  action: AuditAction;
  before?: any;
  after?: any;
  reason?: string | null;
}): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return; // no session, skip silently
    const source = args.after ?? args.before ?? {};
    const meta = entityFieldsFor(args.table, source);
    await supabase.from("financial_audit_log").insert({
      table_name: args.table,
      record_id: args.recordId,
      action: args.action,
      reason: args.reason ?? null,
      performed_by: userId,
      before_value: args.before ?? null,
      after_value: args.after ?? null,
      ...meta,
    } as any);
  } catch (err) {
    // Never let audit failure block the primary financial operation.
    // eslint-disable-next-line no-console
    console.warn("[audit] logFinancialAudit failed", err);
  }
}

/**
 * Convenience: log a create when you have an id + the inserted row.
 */
export async function logCreate(table: AuditTable, recordId: string, row: any, reason?: string | null) {
  return logFinancialAudit({ table, recordId, action: "create", after: row, reason });
}
