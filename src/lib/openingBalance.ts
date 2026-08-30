// ============================================================================
// Opening Balances — V2 (Multi-Currency, Ledger-only, Single Source of Truth)
// ============================================================================
//
// Architectural rules (enforced across the app):
//
//   • Opening Balance IS NOT a value on the entity table.
//     Opening Balance = a set of Ledger Entries.
//
//   • Each Entry = { currency, kind: 'debit' | 'credit', amount, date, note }
//     Stored as ONE row in the entity's ledger table with
//        source_service_type IN ('opening_debit', 'opening_credit')
//        source_service_id   = entity uuid
//        currency (or opening_currency, depending on the table)
//
//   • Sync uses FULL REPLACE: DELETE all opening rows for the entity, then
//     INSERT the new set. No delta calculation. No per-currency filter.
//
//   • Reads always come from the ledger via readEntityOpeningEntries().
//     Never from entity.opening_debit / opening_credit / opening_currency.
//
//   • Cash Box opening balance is out of scope for this file's V2 API;
//     syncCashBoxOpeningBalance is preserved untouched below.
//
// Deprecated legacy sync fns (syncAgentOpeningBalance, syncCompanyOpeningBalance,
// syncMerchantOpeningBalance, syncCurrencySupplierOpeningBalance) were removed
// in this refactor — all callers now use syncEntityOpeningEntries().
// ============================================================================
import { supabase } from "@/integrations/supabase/client";
import { normalizeCurrency } from "@/lib/db";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type OpeningEntityKind = "agent" | "company" | "merchant" | "currency_supplier";
export type OpeningKind = "debit" | "credit";

export type OpeningEntry = {
  // Optional client-side row id used only inside the editor UI.
  uid?: string;
  // Optional ledger row id when the entry was loaded from the DB.
  ledger_id?: string;
  currency: string;          // 'EGP' | 'USD' | 'LYD'
  kind: OpeningKind;
  amount: number;            // > 0
  date: string;              // YYYY-MM-DD
  note: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type Mapping = {
  table: string;
  entityCol: string;
  currencyCol: "currency" | "opening_currency";
  dateCol: "date" | "tx_date";
};

function mappingFor(kind: OpeningEntityKind): Mapping {
  switch (kind) {
    case "agent":
      return { table: "transactions", entityCol: "agent_id", currencyCol: "currency", dateCol: "date" };
    case "company":
      return { table: "company_transactions", entityCol: "company_id", currencyCol: "currency", dateCol: "date" };
    case "merchant":
      return { table: "merchant_cash_collections", entityCol: "merchant_id", currencyCol: "opening_currency", dateCol: "date" };
    case "currency_supplier":
      return { table: "currency_supplier_transactions", entityCol: "supplier_id", currencyCol: "opening_currency", dateCol: "tx_date" };
  }
}

// ---------------------------------------------------------------------------
// Row builders (one INSERT row per entry, matching each ledger's schema)
// ---------------------------------------------------------------------------
function buildAgentRow(entityId: string, e: OpeningEntry): any {
  const base = {
    agent_id: entityId,
    date: e.date,
    destination: null,
    payment_method: "نقدي",
    service_type: "رصيد سابق",
    travel_statement: null,
    note: e.note || null,
    source_service_type: e.kind === "debit" ? "opening_debit" : "opening_credit",
    source_service_id: entityId,
    currency: e.currency,
    instapay_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
  };
  return e.kind === "debit"
    ? { ...base, count: 1, price: e.amount, paid: 0, total_paid: 0, cash_amount: 0 }
    : { ...base, count: 0, price: 0,        paid: e.amount, total_paid: e.amount, cash_amount: e.amount };
}

function buildCompanyRow(entityId: string, e: OpeningEntry): any {
  const base = {
    company_id: entityId,
    date: e.date,
    destination: null,
    service_type: "رصيد سابق",
    note: e.note || null,
    source_service_type: e.kind === "debit" ? "opening_debit" : "opening_credit",
    source_service_id: entityId,
    currency: e.currency,
    instapay_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
  };
  return e.kind === "debit"
    ? { ...base, count: 1, price: e.amount, trip_value: e.amount, total_paid: 0, cash_amount: 0 }
    : { ...base, count: 0, price: 0,        trip_value: 0,        total_paid: e.amount, cash_amount: e.amount };
}

function buildMerchantRow(entityId: string, e: OpeningEntry): any {
  // Merchant statement balance formula: collections contribute delta = -amount
  //   opening_debit  (merchant owes us) => amount = -entry.amount
  //   opening_credit (we owe merchant)  => amount = +entry.amount
  return {
    merchant_id: entityId,
    date: e.date,
    amount: e.kind === "debit" ? -e.amount : e.amount,
    note: e.note || null,
    statement: "رصيد سابق",
    source_service_type: e.kind === "debit" ? "opening_debit" : "opening_credit",
    source_service_id: entityId,
    opening_currency: e.currency,
  };
}

function buildCurrencySupplierRow(entityId: string, e: OpeningEntry): any {
  return {
    supplier_id: entityId,
    tx_date: e.date,
    tx_type: "رصيد سابق",
    bought_currency: e.currency,
    sold_currency: e.currency,
    bought_amount: e.kind === "debit" ? e.amount : 0,
    sold_amount:   e.kind === "credit" ? e.amount : 0,
    exchange_rate: null,
    description: e.note || null,
    statement: "رصيد سابق",
    source_service_type: e.kind === "debit" ? "opening_debit" : "opening_credit",
    source_service_id: entityId,
    opening_currency: e.currency,
  };
}

function buildRow(kind: OpeningEntityKind, entityId: string, e: OpeningEntry): any {
  switch (kind) {
    case "agent":             return buildAgentRow(entityId, e);
    case "company":           return buildCompanyRow(entityId, e);
    case "merchant":          return buildMerchantRow(entityId, e);
    case "currency_supplier": return buildCurrencySupplierRow(entityId, e);
  }
}

// ---------------------------------------------------------------------------
// Row parsers (ledger row → OpeningEntry)
// ---------------------------------------------------------------------------
function parseAgentRow(r: any): OpeningEntry {
  const kind: OpeningKind = r.source_service_type === "opening_debit" ? "debit" : "credit";
  const amount = kind === "debit" ? Number(r.price || 0) : Number(r.total_paid || r.paid || r.cash_amount || 0);
  return {
    ledger_id: r.id, kind, amount,
    currency: normalizeCurrency(r.currency),
    date: String(r.date || ""),
    note: r.note || null,
  };
}

function parseCompanyRow(r: any): OpeningEntry {
  const kind: OpeningKind = r.source_service_type === "opening_debit" ? "debit" : "credit";
  const amount = kind === "debit" ? Number(r.price || r.trip_value || 0) : Number(r.total_paid || r.cash_amount || 0);
  return {
    ledger_id: r.id, kind, amount,
    currency: normalizeCurrency(r.currency),
    date: String(r.date || ""),
    note: r.note || null,
  };
}

function parseMerchantRow(r: any): OpeningEntry {
  const kind: OpeningKind = r.source_service_type === "opening_debit" ? "debit" : "credit";
  return {
    ledger_id: r.id, kind,
    amount: Math.abs(Number(r.amount || 0)),
    currency: normalizeCurrency(r.opening_currency),
    date: String(r.date || ""),
    note: r.note || null,
  };
}

function parseCurrencySupplierRow(r: any): OpeningEntry {
  const kind: OpeningKind = r.source_service_type === "opening_debit" ? "debit" : "credit";
  return {
    ledger_id: r.id, kind,
    amount: kind === "debit" ? Number(r.bought_amount || 0) : Number(r.sold_amount || 0),
    currency: normalizeCurrency(r.opening_currency || r.bought_currency),
    date: String(r.tx_date || ""),
    note: r.description || null,
  };
}

function parseRow(kind: OpeningEntityKind, r: any): OpeningEntry {
  switch (kind) {
    case "agent":             return parseAgentRow(r);
    case "company":           return parseCompanyRow(r);
    case "merchant":          return parseMerchantRow(r);
    case "currency_supplier": return parseCurrencySupplierRow(r);
  }
}

// ---------------------------------------------------------------------------
// Public API — READ
// ---------------------------------------------------------------------------
/**
 * Reads opening entries for an entity strictly from the Ledger.
 * Never touches entity.opening_debit / opening_credit / opening_currency.
 */
export async function readEntityOpeningEntries(
  kind: OpeningEntityKind,
  entityId: string,
): Promise<OpeningEntry[]> {
  if (!entityId) return [];
  const m = mappingFor(kind);
  const { data, error } = await supabase
    .from(m.table as any)
    .select("*")
    .eq(m.entityCol, entityId)
    .in("source_service_type", ["opening_debit", "opening_credit"] as any);
  if (error) throw error;
  const entries = (data || []).map((r: any) => parseRow(kind, r));
  // Deterministic sort: EGP → USD → LYD → others; then debit before credit.
  const curOrder = (c: string) => (c === "EGP" ? 0 : c === "USD" ? 1 : c === "LYD" ? 2 : 3);
  entries.sort((a, b) => (curOrder(a.currency) - curOrder(b.currency)) || (a.kind === "debit" ? -1 : 1));
  return entries;
}

// ---------------------------------------------------------------------------
// Public API — WRITE (full replace)
// ---------------------------------------------------------------------------
/**
 * Full replace: deletes every opening row for the entity and inserts the
 * provided entries. No delta. No per-currency filter. Single Source of Truth.
 *
 * Entries with amount<=0 or missing currency are dropped silently.
 * Entries with the same (currency, kind) are merged (amounts summed) to
 * satisfy unique constraints on merchant / currency-supplier ledgers.
 */
export async function syncEntityOpeningEntries(
  kind: OpeningEntityKind,
  entityId: string,
  entries: OpeningEntry[],
): Promise<void> {
  if (!entityId) return;
  // 1) Clean input
  const clean: OpeningEntry[] = [];
  for (const e of entries || []) {
    const amount = Number(e?.amount) || 0;
    const currency = normalizeCurrency(e?.currency);
    if (!(amount > 0) || !currency) continue;
    clean.push({
      currency,
      kind: e.kind === "credit" ? "credit" : "debit",
      amount,
      date: e.date && String(e.date).length >= 8 ? e.date : todayISO(),
      note: e.note ? String(e.note).trim() || null : null,
    });
  }

  // 2) Merge duplicates (same currency + kind) — sums amount, keeps earliest
  // date and joins notes. Matches DB unique constraint on merchant / CS.
  const merged = new Map<string, OpeningEntry>();
  for (const e of clean) {
    const key = `${e.currency}|${e.kind}`;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, { ...e }); continue; }
    prev.amount += e.amount;
    if (e.date && (!prev.date || e.date < prev.date)) prev.date = e.date;
    if (e.note) prev.note = prev.note ? `${prev.note} | ${e.note}` : e.note;
  }
  const finalEntries = Array.from(merged.values());

  // 3) Full replace inside ONE PostgreSQL transaction. If any new row fails,
  // the DELETE is rolled back and the previous opening balance remains intact.
  const rows = finalEntries.map((e) => buildRow(kind, entityId, e));
  const { data, error } = await (supabase as any).rpc("replace_entity_opening_entries_atomic", {
    p_kind: kind,
    p_entity_id: entityId,
    p_rows: rows,
  });
  if (error || data?.ok !== true) {
    const message = String(error?.message || data?.error || "تعذر حفظ الرصيد الافتتاحي");
    const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
    throw new Error(missingRpc ? "تم إيقاف العملية بدون تغيير أي جزء: تحديث الأرصدة الافتتاحية الذري غير مُطبق على قاعدة البيانات بعد." : message);
  }
}

// ---------------------------------------------------------------------------
// Cash Box opening balance — PRESERVED (out of scope for V2)
// ---------------------------------------------------------------------------
export type CashBoxOpeningInput = {
  amount: number;
  date: string | null;
  note: string | null;
};

/**
 * Sets a cash-box opening balance. Adjusts cash_boxes.balance by the delta
 * against the previously recorded opening_balance so re-entering doesn't
 * double-count. Also records a marker row in usd_treasury_transactions
 * (source_service_type='opening') so it appears in treasury statements.
 *
 * NOTE: This function is NOT part of the V2 ledger-only opening system.
 * Cash Box unification is tracked as a separate PR.
 */
export async function syncCashBoxOpeningBalance(cashBoxId: string, op: CashBoxOpeningInput) {
  if (!cashBoxId) return;
  const amount = Number(op.amount) || 0;
  const date = op.date || todayISO();
  const { data, error } = await (supabase as any).rpc("sync_cash_box_opening_atomic", {
    p_cash_box_id: cashBoxId,
    p_amount: amount,
    p_date: date,
    p_note: op.note || null,
  });
  if (error || data?.ok !== true) {
    const message = String(error?.message || data?.error || "تعذر حفظ رصيد الخزينة الافتتاحي");
    const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
    throw new Error(missingRpc ? "تم إيقاف العملية بدون تغيير أي جزء: تحديث رصيد الخزينة الذري غير مُطبق على قاعدة البيانات بعد." : message);
  }
}
