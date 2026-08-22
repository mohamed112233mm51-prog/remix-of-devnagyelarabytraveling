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

const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(name, args);

/**
 * Parallel server-side read model. Do not replace an existing financial UI
 * with this result until its output has been reconciled with the legacy ledger
 * for the same entity and currency.
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

  const currencies = new Set<string>();
  for (const key of legacyByCurrency.keys()) currencies.add(normalizeCurrency(key));
  for (const key of serverByCurrency.keys()) currencies.add(normalizeCurrency(key));

  return Array.from(currencies)
    .sort()
    .map((currency) => {
      const legacy = Number(legacyByCurrency.get(currency) || 0);
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
