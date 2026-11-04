import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseArchiveScope } from "@/lib/expenseArchive";

export const TREASURY_PAGE_SIZE = 50;
export type TreasuryLedgerRow = {
  id: string; cashBoxId: string; cashBoxName: string; performedAt: string | null;
  kind: string; type: string; direction: "in" | "out"; directionLabel: string;
  amount: number; currency: string; counterparty: string; details: string;
  balanceAfter: number; from: string; to: string;
};
export type TreasuryLedgerPage = {
  rows: TreasuryLedgerRow[]; total: number; page: number; pageSize: number;
  months: string[]; currentCount: number; archivedCount: number; upcomingCount: number; undatedCount: number;
};
export type TreasuryLedgerRequest = {
  boxIds: string[]; scope: ExpenseArchiveScope; month: string; page: number;
  boxId: string; direction: string; search: string; operations: boolean; kind: string;
};
export const emptyTreasuryPage: TreasuryLedgerPage = {
  rows: [], total: 0, page: 0, pageSize: TREASURY_PAGE_SIZE, months: [],
  currentCount: 0, archivedCount: 0, upcomingCount: 0, undatedCount: 0,
};
export async function readTreasuryLedgerPage(
  client: Pick<SupabaseClient, "rpc">, request: TreasuryLedgerRequest, signal?: AbortSignal,
): Promise<TreasuryLedgerPage> {
  if (!request.boxIds.length) return emptyTreasuryPage;
  let query = client.rpc("get_treasury_ledger_page", {
    p_box_ids: [...request.boxIds].sort(), p_scope: request.scope, p_month: request.month || null,
    p_page: request.page, p_box_id: request.boxId || null, p_direction: request.direction || null,
    p_search: request.search.trim(), p_operations: request.operations, p_kind: request.kind || null,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST202") throw new Error("يلزم تطبيق تحديث قراءة سجل الخزائن على قاعدة البيانات");
    throw new Error(error.message || "تعذر تحميل سجل الخزائن");
  }
  if (!data || !Array.isArray(data.rows) || data.rows.length > TREASURY_PAGE_SIZE) {
    throw new Error("تعذر تأكيد بيانات صفحة سجل الخزائن");
  }
  return data as TreasuryLedgerPage;
}
