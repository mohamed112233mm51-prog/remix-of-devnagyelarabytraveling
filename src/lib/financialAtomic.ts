import { supabase } from "@/integrations/supabase/client";
import { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";
import type { MovementSplit } from "@/lib/financialEngine";

export type FinancialAtomicTable =
  | "transactions"
  | "company_transactions"
  | "payment_splits"
  | "expenses"
  | "expense_deductions"
  | "merchant_cash_collections"
  | "investor_transactions"
  | "currency_supplier_transactions"
  | "cash_transfers";

export type FinancialAtomicRow = {
  table: FinancialAtomicTable;
  row: Record<string, unknown>;
  /** Wrapper-only validation hint consumed by execute_financial_atomic. */
  require_cash_box?: boolean;
};

export type FinancialAtomicResult<T = Record<string, unknown>> = {
  ok: boolean;
  reused?: boolean;
  result?: T;
  error?: string;
};

export function atomicRow(
  table: FinancialAtomicTable,
  row: Record<string, unknown>,
  options?: { requireCashBox?: boolean },
): FinancialAtomicRow {
  return {
    table,
    row,
    ...(options?.requireCashBox ? { require_cash_box: true } : {}),
  };
}

/**
 * One call to execute_financial_atomic is one PostgreSQL transaction.
 * There is deliberately NO legacy fallback: if the migration/RPC is missing,
 * the financial save fails closed instead of risking a half-written operation.
 */
export async function executeFinancialAtomic<T = Record<string, unknown>>(args: {
  operationId: string;
  fingerprint: string;
  rows: FinancialAtomicRow[];
  result?: T;
}): Promise<FinancialAtomicResult<T>> {
  if (!args.operationId || !args.fingerprint || args.rows.length === 0) {
    return { ok: false, error: "بيانات العملية المالية الذرية غير مكتملة" };
  }

  const { data, error } = await (supabase as any).rpc("execute_financial_atomic", {
    p_operation_id: args.operationId,
    p_fingerprint: args.fingerprint,
    p_rows: args.rows,
    p_result: args.result || {},
  });

  if (error) {
    const message = String(error.message || error || "");
    const code = String((error as any)?.code || "");
    const rpcMissing =
      code === "PGRST202"
      || message.toLowerCase().includes("execute_financial_atomic")
        && (message.toLowerCase().includes("could not find") || message.toLowerCase().includes("schema cache"));

    if (rpcMissing) {
      return {
        ok: false,
        error: "تم إيقاف العملية بدون تسجيل أي جزء: تحديث الحفظ المالي الذري غير مُطبق على قاعدة البيانات بعد.",
      };
    }
    return { ok: false, error: message || "فشل الحفظ المالي الذري" };
  }

  const payload = (data || {}) as any;
  if (payload.ok !== true) {
    return { ok: false, error: payload.error || "تعذر تأكيد الحفظ المالي الذري" };
  }

  return {
    ok: true,
    reused: Boolean(payload.reused),
    result: (payload.result || args.result || {}) as T,
  };
}

/**
 * Convert the engine's split model into deterministic payment_splits rows that
 * can be sent together with parents/children in one atomic RPC.
 */
export function buildAtomicPaymentSplitRows(args: {
  operationId: string;
  splits: MovementSplit[];
  transactionId?: string | null;
  sourceTable: string;
  sourceId?: string | null;
  childPrefix?: string;
}): FinancialAtomicRow[] {
  const prefix = args.childPrefix || "split";
  return args.splits
    .filter((s) => Number(s.amount) > 0)
    .map((s, index) => atomicRow("payment_splits", {
      id: deriveFinancialOperationUuid(args.operationId, `${prefix}:${index}`),
      transaction_id: args.transactionId || null,
      method: s.method,
      currency: s.currency,
      cash_box_id: s.cashBoxId || null,
      amount: Number(s.amount),
      direction: s.direction,
      source_table: args.sourceTable,
      source_id: args.sourceId || null,
      gross_amount: s.grossAmount ?? s.amount,
      merchant_commission_rate: s.commissionRate ?? 0,
      merchant_commission_amount: s.commissionAmount ?? 0,
      net_amount: s.netAmount ?? s.amount,
      exchange_rate: s.exchangeRate ?? 1,
      egp_equivalent:
        s.egpEquivalent
        ?? (s.currency === "EGP" ? s.amount : s.amount * (s.exchangeRate ?? 1)),
    }, { requireCashBox: s.requiresCashBox === true }));
}
