import { supabase } from "@/integrations/supabase/client";
import { normalizeCurrency } from "@/lib/db";
import type { CanonicalV2PartyType } from "@/lib/serverFinancialRead";

export type CanonicalLedgerV2PartyType = Exclude<CanonicalV2PartyType, "investor">;

export type CanonicalLedgerRowV2 = {
  row_key: string;
  source_table: string;
  source_id: string;
  accounting_date: string;
  created_at: string;
  currency: string;
  debit: number;
  credit: number;
  delta: number;
  running_balance: number;
  total_count: number;
  row_kind: string;
};

export type CanonicalReconciliationRowV2 = {
  party_type: CanonicalV2PartyType;
  party_id: string;
  party_name: string;
  currency: string;
  debit: number;
  credit: number;
  balance: number;
  row_count: number;
  engine: string;
};

export type CanonicalReconciliationTotalV2 = {
  party_type: CanonicalV2PartyType;
  currency: string;
  entity_count: number;
  debit: number;
  credit: number;
  balance: number;
  source_row_count: number;
};

const rpc = (name: string, args: Record<string, unknown> = {}) =>
  (supabase as any).rpc(name, args);

/**
 * Canonical server-side ledger. The database computes the full-history running
 * balance first and only then returns the requested page. No browser-side
 * history aggregation is required.
 */
export async function fetchCanonicalLedgerPageV2(args: {
  partyType: CanonicalLedgerV2PartyType;
  partyId: string;
  currency?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}): Promise<CanonicalLedgerRowV2[]> {
  const { data, error } = await rpc("financial_entity_ledger_page_v2", {
    p_party_type: args.partyType,
    p_party_id: args.partyId,
    p_currency: args.currency ? normalizeCurrency(args.currency) : null,
    p_from: args.from || null,
    p_to: args.to || null,
    p_limit: Math.max(1, Math.min(args.limit ?? 100, 500)),
    p_offset: Math.max(0, args.offset ?? 0),
  });

  if (error) throw new Error(error.message || "تعذر تحميل كشف الحساب من المحرك المالي canonical v2");

  return (Array.isArray(data) ? data : []).map((row: any) => ({
    row_key: String(row.row_key || ""),
    source_table: String(row.source_table || ""),
    source_id: String(row.source_id || ""),
    accounting_date: String(row.accounting_date || ""),
    created_at: String(row.created_at || ""),
    currency: normalizeCurrency(row.currency),
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    delta: Number(row.delta || 0),
    running_balance: Number(row.running_balance || 0),
    total_count: Number(row.total_count || 0),
    row_kind: String(row.row_kind || ""),
  }));
}

/** Full system snapshot for pre-cutover reconciliation. Read-only. */
export async function fetchCanonicalReconciliationSnapshotV2(): Promise<CanonicalReconciliationRowV2[]> {
  const { data, error } = await rpc("financial_reconciliation_snapshot_v2");
  if (error) throw new Error(error.message || "تعذر تحميل تقرير مطابقة المحرك المالي");
  return (Array.isArray(data) ? data : []).map((row: any) => ({
    party_type: String(row.party_type) as CanonicalV2PartyType,
    party_id: String(row.party_id),
    party_name: String(row.party_name || ""),
    currency: normalizeCurrency(row.currency),
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    balance: Number(row.balance || 0),
    row_count: Number(row.row_count || 0),
    engine: String(row.engine || "canonical_v2"),
  }));
}

/** Aggregated smoke-check snapshot by party type and currency. Read-only. */
export async function fetchCanonicalReconciliationTotalsV2(): Promise<CanonicalReconciliationTotalV2[]> {
  const { data, error } = await rpc("financial_reconciliation_totals_v2");
  if (error) throw new Error(error.message || "تعذر تحميل إجماليات مطابقة المحرك المالي");
  return (Array.isArray(data) ? data : []).map((row: any) => ({
    party_type: String(row.party_type) as CanonicalV2PartyType,
    currency: normalizeCurrency(row.currency),
    entity_count: Number(row.entity_count || 0),
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    balance: Number(row.balance || 0),
    source_row_count: Number(row.source_row_count || 0),
  }));
}
