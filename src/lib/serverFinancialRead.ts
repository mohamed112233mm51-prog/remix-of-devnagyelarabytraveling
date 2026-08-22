import { supabase } from "@/integrations/supabase/client";
import { normalizeCurrency } from "@/lib/db";

export type ServerFinancialPartyType =
  | "agent"
  | "company"
  | "merchant"
  | "investor"
  | "currency_supplier"
  | "expense";

export type ServerEntityBalanceRow = {
  currency: string;
  debit: number;
  credit: number;
  balance: number;
  split_count: number;
};

export type ServerEntityLedgerRow = {
  id: string;
  transaction_id: string | null;
  method: string | null;
  currency: string;
  cash_box_id: string | null;
  amount: number;
  direction: string;
  source_table: string;
  source_id: string;
  created_at: string;
  running_balance: number;
  total_count: number;
};

export type BalanceComparison = {
  currency: string;
  legacy: number;
  server: number;
  difference: number;
  matches: boolean;
};

export type FinancialEntityCoverage = {
  party_type: ServerFinancialPartyType;
  party_id: string;
  parent_table: string;
  parent_count: number;
  linked_parent_count: number;
  unlinked_parent_count: number;
  active_split_count: number;
  coverage_complete: boolean;
};

export type FinancialSystemCoverage = {
  party_type: Exclude<ServerFinancialPartyType, "expense">;
  entity_count: number;
  parent_count: number;
  linked_parent_count: number;
  unlinked_parent_count: number;
  coverage_complete: boolean;
};

const rpc = (name: string, args: Record<string, unknown> = {}) =>
  (supabase as any).rpc(name, args);

/**
 * Parallel server-side read model.
 * IMPORTANT: this v1 balance is payment_splits-based and MUST NOT replace a
 * legacy financial view until BOTH conditions are true:
 *  1) historical coverage is complete for the entity; and
 *  2) reconciliation matches the current production-equivalent calculation.
 */
export async function fetchServerEntityBalances(
  partyType: ServerFinancialPartyType,
  partyId: string,
): Promise<ServerEntityBalanceRow[]> {
  const { data, error } = await rpc("financial_entity_balance_v1", {
    p_party_type: partyType,
    p_party_id: partyId,
  });
  if (error) throw new Error(error.message || "تعذر تحميل الرصيد من المحرك المالي الجديد");
  return (Array.isArray(data) ? data : []).map((row: any) => ({
    currency: normalizeCurrency(row.currency),
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    balance: Number(row.balance || 0),
    split_count: Number(row.split_count || 0),
  }));
}

export async function fetchServerEntityLedgerPage(args: {
  partyType: ServerFinancialPartyType;
  partyId: string;
  currency?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}): Promise<ServerEntityLedgerRow[]> {
  const { data, error } = await rpc("financial_entity_ledger_page_v1", {
    p_party_type: args.partyType,
    p_party_id: args.partyId,
    p_currency: args.currency ? normalizeCurrency(args.currency) : null,
    p_from: args.from || null,
    p_to: args.to || null,
    p_limit: Math.max(1, Math.min(args.limit ?? 100, 500)),
    p_offset: Math.max(0, args.offset ?? 0),
  });
  if (error) throw new Error(error.message || "تعذر تحميل كشف الحساب من المحرك المالي الجديد");
  return (Array.isArray(data) ? data : []).map((row: any) => ({
    id: String(row.id),
    transaction_id: row.transaction_id ? String(row.transaction_id) : null,
    method: row.method ?? null,
    currency: normalizeCurrency(row.currency),
    cash_box_id: row.cash_box_id ? String(row.cash_box_id) : null,
    amount: Number(row.amount || 0),
    direction: String(row.direction || ""),
    source_table: String(row.source_table || ""),
    source_id: String(row.source_id || ""),
    created_at: String(row.created_at || ""),
    running_balance: Number(row.running_balance || 0),
    total_count: Number(row.total_count || 0),
  }));
}

/** Read-only historical-coverage diagnostic for one entity. */
export async function fetchEntityFinancialCoverage(
  partyType: ServerFinancialPartyType,
  partyId: string,
): Promise<FinancialEntityCoverage> {
  const { data, error } = await rpc("financial_entity_coverage_v1", {
    p_party_type: partyType,
    p_party_id: partyId,
  });
  if (error) throw new Error(error.message || "تعذر فحص اكتمال التاريخ المالي");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("لم يتم إرجاع نتيجة فحص اكتمال التاريخ المالي");
  return {
    party_type: partyType,
    party_id: String(row.party_id || partyId),
    parent_table: String(row.parent_table || ""),
    parent_count: Number(row.parent_count || 0),
    linked_parent_count: Number(row.linked_parent_count || 0),
    unlinked_parent_count: Number(row.unlinked_parent_count || 0),
    active_split_count: Number(row.active_split_count || 0),
    coverage_complete: Boolean(row.coverage_complete),
  };
}

/** System-wide diagnostic. Used only during migration/reconciliation. */
export async function fetchSystemFinancialCoverage(): Promise<FinancialSystemCoverage[]> {
  const { data, error } = await rpc("financial_system_coverage_v1");
  if (error) throw new Error(error.message || "تعذر فحص اكتمال التاريخ المالي للنظام");
  return (Array.isArray(data) ? data : []).map((row: any) => ({
    party_type: String(row.party_type) as FinancialSystemCoverage["party_type"],
    entity_count: Number(row.entity_count || 0),
    parent_count: Number(row.parent_count || 0),
    linked_parent_count: Number(row.linked_parent_count || 0),
    unlinked_parent_count: Number(row.unlinked_parent_count || 0),
    coverage_complete: Boolean(row.coverage_complete),
  }));
}

/**
 * Hard cutover gate. It intentionally fails closed: if a single historical
 * parent row is not represented in the new read model, callers must keep using
 * the legacy production-equivalent calculation.
 */
export async function assertEntitySafeForServerCutover(
  partyType: ServerFinancialPartyType,
  partyId: string,
): Promise<FinancialEntityCoverage> {
  const coverage = await fetchEntityFinancialCoverage(partyType, partyId);
  if (!coverage.coverage_complete || coverage.unlinked_parent_count > 0) {
    throw new Error(
      `FINANCIAL_CUTOVER_BLOCKED: ${coverage.unlinked_parent_count} historical row(s) are not represented in the new server read model`,
    );
  }
  return coverage;
}

/**
 * Pure reconciliation helper used during migration. It never writes data.
 * legacyByCurrency must come from the existing production-equivalent logic.
 */
export function compareServerBalances(
  legacyByCurrency: ReadonlyMap<string, number>,
  serverRows: readonly ServerEntityBalanceRow[],
  tolerance = 0.01,
): BalanceComparison[] {
  const serverByCurrency = new Map<string, number>();
  for (const row of serverRows) {
    const currency = normalizeCurrency(row.currency);
    serverByCurrency.set(currency, (serverByCurrency.get(currency) || 0) + Number(row.balance || 0));
  }

  const normalizedLegacy = new Map<string, number>();
  for (const [key, value] of legacyByCurrency) {
    const currency = normalizeCurrency(key);
    normalizedLegacy.set(currency, (normalizedLegacy.get(currency) || 0) + Number(value || 0));
  }

  const currencies = new Set<string>();
  for (const key of normalizedLegacy.keys()) currencies.add(key);
  for (const key of serverByCurrency.keys()) currencies.add(key);

  return Array.from(currencies)
    .sort()
    .map((currency) => {
      const legacy = Number(normalizedLegacy.get(currency) || 0);
      const server = Number(serverByCurrency.get(currency) || 0);
      const difference = server - legacy;
      return {
        currency,
        legacy,
        server,
        difference,
        matches: Math.abs(difference) <= tolerance,
      };
    });
}
