/**
 * Execution Profit — Single Source of Truth (Multi-Currency, Locked FX)
 *
 * Rules (accounting-correct, historically immutable):
 *  - Profit is always computed in EGP.
 *  - Foreign-currency legs (USD/LYD/…) are converted to EGP using the exchange
 *    rate LOCKED for that execution — stored in `executions.fx_locks`.
 *  - The lock is set ONCE, the first time all currencies in the execution have
 *    a resolvable rate. After that, it never changes — even if the user later
 *    records a newer buy rate.
 *  - Rate source: the latest `currency_supplier_transactions` row with
 *      tx_type = 'شراء عملة'
 *      bought_currency = <currency>
 *      sold_currency  = 'EGP'
 *      cancelled_at IS NULL
 *      tx_date <= execution date
 *    Rate = sold_amount / bought_amount (EGP per 1 unit of currency).
 *  - If ANY non-EGP currency used in the execution has no such rate on/before
 *    the execution date, the execution is "pending" (profit is null) and is
 *    excluded from all system profit aggregates until the lock succeeds later.
 *  - Cancelled executions / cancelled expense rows / cancelled currency-supplier
 *    rows are excluded.
 *
 * This module is the ONLY place that computes execution profit.
 * Dashboard / Reports / Profit summary all call `computeExecutionProfitEGP`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type FxLocks = Record<string, number>; // { USD: 50, LYD: 10 }

export interface ExecutionRow {
  id: string;
  travel_date?: string | null;
  created_at?: string | null;
  operation_status?: string | null;
  services?: any;
  fx_locks?: FxLocks | null;
  fx_locked_at?: string | null;
}

export interface ProfitBreakdown {
  status: "locked" | "pending" | "excluded";
  profitEGP: number | null;
  salesEGP: number;
  companyCostEGP: number;
  missingCurrencies: string[];
  usedCurrencies: string[];
  fxUsed: FxLocks;
  reason?: string;
}

function safeCurrency(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return s || "EGP";
}

/** Extract per-currency sales & company-cost totals from an execution's services. */
export function aggregateExecutionByCurrency(ex: ExecutionRow) {
  const salesByCur: Record<string, number> = {};
  const costByCur: Record<string, number> = {};
  const services = Array.isArray(ex.services) ? ex.services : [];
  for (const s of services) {
    if (!s || typeof s !== "object") continue;
    const count = Math.max(1, Math.round(Number((s as any).count) || 1));
    const agentPrice = Math.max(0, Number((s as any).agent_price) || 0);
    const companyPrice = Math.max(0, Number((s as any).company_price) || 0);
    const explicitCompanyValue = Math.max(0, Number((s as any).company_value) || 0);
    const companyValue = explicitCompanyValue > 0 ? explicitCompanyValue : companyPrice * count;
    const kind = (s as any).kind as string | undefined;
    const cur = safeCurrency((s as any).currency);
    if (kind === "company") {
      if (companyValue > 0) costByCur[cur] = (costByCur[cur] || 0) + companyValue;
    } else if (kind === "agent") {
      const amt = agentPrice * count;
      if (amt > 0) salesByCur[cur] = (salesByCur[cur] || 0) + amt;
    } else {
      // legacy row: has both agent + company sides
      const amt = agentPrice * count;
      if (amt > 0) salesByCur[cur] = (salesByCur[cur] || 0) + amt;
      if ((s as any).company_id && companyValue > 0) {
        costByCur[cur] = (costByCur[cur] || 0) + companyValue;
      }
    }
  }
  return { salesByCur, costByCur };
}

/**
 * Pure profit computation from an execution + its (already stored) fx_locks.
 * NO DB access — safe for client, server, reports, dashboards.
 */
export function computeExecutionProfitEGP(ex: ExecutionRow): ProfitBreakdown {
  if ((ex.operation_status || "") !== "منفذ") {
    return {
      status: "excluded",
      profitEGP: null,
      salesEGP: 0,
      companyCostEGP: 0,
      missingCurrencies: [],
      usedCurrencies: [],
      fxUsed: {},
      reason: "operation_status != منفذ",
    };
  }

  const { salesByCur, costByCur } = aggregateExecutionByCurrency(ex);
  const usedCurrencies = Array.from(
    new Set([...Object.keys(salesByCur), ...Object.keys(costByCur)]),
  );
  const foreign = usedCurrencies.filter((c) => c !== "EGP");
  const locks: FxLocks = (ex.fx_locks && typeof ex.fx_locks === "object") ? ex.fx_locks : {};
  const missing = foreign.filter((c) => !(Number(locks[c]) > 0));
  if (missing.length > 0) {
    return {
      status: "pending",
      profitEGP: null,
      salesEGP: 0,
      companyCostEGP: 0,
      missingCurrencies: missing,
      usedCurrencies,
      fxUsed: locks,
      reason: `لا يوجد سعر شراء مثبت للعملات: ${missing.join(", ")}`,
    };
  }

  const fxUsed: FxLocks = {};
  const rateFor = (cur: string) => {
    if (cur === "EGP") return 1;
    const r = Number(locks[cur]);
    fxUsed[cur] = r;
    return r;
  };

  let salesEGP = 0;
  for (const [cur, amt] of Object.entries(salesByCur)) salesEGP += amt * rateFor(cur);
  let costEGP = 0;
  for (const [cur, amt] of Object.entries(costByCur)) costEGP += amt * rateFor(cur);

  return {
    status: "locked",
    profitEGP: salesEGP - costEGP,
    salesEGP,
    companyCostEGP: costEGP,
    missingCurrencies: [],
    usedCurrencies,
    fxUsed,
  };
}

/**
 * Shared helper: sum executed agent sales in EGP across many executions
 * using the locked FX rates only. Pending/excluded rows are skipped.
 * This is THE single source of truth for "إجمالي مبيعات الوكلاء".
 */
export function computeExecutionSalesEGP(rows: ExecutionRow[]): {
  salesEGP: number;
  pending: number;
} {
  let salesEGP = 0;
  let pending = 0;
  for (const ex of rows) {
    if ((ex.operation_status || "") !== "منفذ") continue;
    const r = computeExecutionProfitEGP(ex);
    if (r.status === "locked") salesEGP += r.salesEGP;
    else if (r.status === "pending") pending += 1;
  }
  return { salesEGP, pending };
}

// ─── DB-backed helpers ────────────────────────────────────────────────────

export type SB = SupabaseClient<any, any, any>;

export interface CurrencyBuyRow {
  tx_date: string;
  created_at: string;
  bought_currency: string;
  bought_amount: number;
  sold_currency: string;
  sold_amount: number;
}

/**
 * Load ALL non-cancelled currency-buy rows (EGP as sold_currency) once.
 * Pass into `resolveRateFromRows` to resolve historical rates at O(1) per call.
 */
export async function loadCurrencyBuyRows(sb: SB): Promise<CurrencyBuyRow[]> {
  const { data, error } = await sb
    .from("currency_supplier_transactions")
    .select("tx_date, created_at, bought_currency, bought_amount, sold_currency, sold_amount, cancelled_at, tx_type")
    .eq("tx_type", "شراء عملة")
    .eq("sold_currency", "EGP")
    .is("cancelled_at", null)
    .order("tx_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).filter((r: any) =>
    Number(r.bought_amount) > 0 && Number(r.sold_amount) > 0 && typeof r.bought_currency === "string",
  ) as CurrencyBuyRow[];
}

/** Latest buy rate for `currency` with tx_date <= onOrBefore. Returns null if none. */
export function resolveRateFromRows(
  rows: CurrencyBuyRow[],
  currency: string,
  onOrBefore: string,
): number | null {
  const cur = currency.toUpperCase();
  if (cur === "EGP") return 1;
  for (const r of rows) {
    if (r.bought_currency.toUpperCase() !== cur) continue;
    if (r.tx_date > onOrBefore) continue;
    const rate = Number(r.sold_amount) / Number(r.bought_amount);
    if (rate > 0 && Number.isFinite(rate)) return rate;
  }
  return null;
}

/**
 * Try to lock FX rates for a single execution.
 * WRITE-SIDE ONLY — never call from a read-only screen (Dashboard, Reports).
 *
 * Rules:
 *  - Only ADDS missing currencies to fx_locks; NEVER overwrites an existing lock.
 *  - `travel_date` is the ONLY date used to pick a historical rate. If the
 *    execution has no `travel_date`, we leave it pending — NO fallback to
 *    `created_at` or "today" is permitted (that would produce a rate that
 *    depends on when the row was created, not on the trip itself).
 *  - Persists to DB only when new locks were added AND all required
 *    currencies are now covered — so we never store a half-locked execution
 *    and later "top it up" with a rate that would have differed earlier.
 *  - The UPDATE is guarded by `fx_locked_at IS NULL` to prevent races
 *    with a concurrent writer that already locked the row.
 */
export async function ensureExecutionFxLocks(
  sb: SB,
  ex: ExecutionRow,
  buyRows?: CurrencyBuyRow[],
): Promise<{ fx_locks: FxLocks; updated: boolean; complete: boolean }> {
  if ((ex.operation_status || "") !== "منفذ") {
    return { fx_locks: (ex.fx_locks as FxLocks) || {}, updated: false, complete: false };
  }
  const { salesByCur, costByCur } = aggregateExecutionByCurrency(ex);
  const foreign = Array.from(
    new Set([...Object.keys(salesByCur), ...Object.keys(costByCur)].filter((c) => c !== "EGP")),
  );
  const existing: FxLocks = { ...((ex.fx_locks as FxLocks) || {}) };
  if (foreign.length === 0) {
    // pure-EGP execution: nothing to lock, always complete
    return { fx_locks: existing, updated: false, complete: true };
  }
  // Strict: travel_date is REQUIRED to resolve a historical rate. Otherwise
  // the execution stays pending until the user supplies it.
  const onOrBefore = (ex.travel_date && String(ex.travel_date).length >= 8)
    ? String(ex.travel_date)
    : null;
  if (!onOrBefore) {
    return { fx_locks: existing, updated: false, complete: false };
  }
  const rows = buyRows ?? (await loadCurrencyBuyRows(sb));

  const next: FxLocks = { ...existing };
  let added = false;
  for (const cur of foreign) {
    if (Number(next[cur]) > 0) continue;
    const rate = resolveRateFromRows(rows, cur, onOrBefore);
    if (rate !== null) {
      next[cur] = rate;
      added = true;
    }
  }
  const complete = foreign.every((c) => Number(next[c]) > 0);
  if (added && complete) {
    // Race-safe: only lock rows that are still unlocked. If a concurrent
    // writer beat us to it, we accept their lock and return the caller's
    // original view (existing) — never overwrite.
    const { data, error } = await sb
      .from("executions")
      .update({ fx_locks: next, fx_locked_at: new Date().toISOString() })
      .eq("id", ex.id)
      .is("fx_locked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return { fx_locks: next, updated: true, complete: true };
    return { fx_locks: existing, updated: false, complete: true };
  }
  return { fx_locks: existing, updated: false, complete };
}

/**
 * Batch-lock any pending executions. WRITE-SIDE ONLY (called from the
 * currency-purchase save flow after a new buy rate is recorded).
 */
export async function lockPendingExecutions(sb: SB, executions: ExecutionRow[]): Promise<ExecutionRow[]> {
  const pending = executions.filter((ex) => {
    if ((ex.operation_status || "") !== "منفذ") return false;
    if (!ex.travel_date) return false; // strict: no travel_date → stays pending
    const { salesByCur, costByCur } = aggregateExecutionByCurrency(ex);
    const foreign = Array.from(
      new Set([...Object.keys(salesByCur), ...Object.keys(costByCur)].filter((c) => c !== "EGP")),
    );
    if (foreign.length === 0) return false;
    const locks = (ex.fx_locks as FxLocks) || {};
    return foreign.some((c) => !(Number(locks[c]) > 0));
  });
  if (pending.length === 0) return executions;
  const rows = await loadCurrencyBuyRows(sb);
  const map = new Map(executions.map((e) => [e.id, { ...e }]));
  for (const ex of pending) {
    try {
      const r = await ensureExecutionFxLocks(sb, ex, rows);
      if (r.updated) {
        const target = map.get(ex.id)!;
        target.fx_locks = r.fx_locks;
      }
    } catch {
      // best-effort; a locking failure must never break aggregate reads
    }
  }
  return Array.from(map.values());
}

// ─── Currency-scoped write-side helpers ──────────────────────────────────
// Called from the currency-purchase save flow so a newly recorded buy rate
// immediately (and exclusively from the write side) unlocks any pending
// executions/expenses that were waiting for it.

/** Lock any pending execution that uses `currency` and has travel_date. */
export async function lockPendingExecutionsForCurrency(sb: SB, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EGP") return 0;
  const { data, error } = await sb
    .from("executions")
    .select("id, travel_date, created_at, operation_status, services, fx_locks, fx_locked_at")
    .eq("operation_status", "منفذ")
    .is("fx_locked_at", null);
  if (error || !data) return 0;
  const rows = await loadCurrencyBuyRows(sb);
  let locked = 0;
  for (const ex of data as any as ExecutionRow[]) {
    const { salesByCur, costByCur } = aggregateExecutionByCurrency(ex);
    const foreign = new Set(
      [...Object.keys(salesByCur), ...Object.keys(costByCur)].filter((c) => c !== "EGP"),
    );
    if (!foreign.has(cur)) continue;
    try {
      const r = await ensureExecutionFxLocks(sb, ex, rows);
      if (r.updated) locked += 1;
    } catch {
      // best-effort
    }
  }
  return locked;
}

// ─── Expense FX Lock (historical, immutable) ─────────────────────────────

export interface ExpenseRow {
  id: string;
  date?: string | null;
  created_at?: string | null;
  amount?: number | null;
  currency?: string | null;
  exchange_rate?: number | null;
  fx_rate?: number | null;
  fx_locked_at?: string | null;
}

export interface ExpenseBreakdown {
  status: "locked" | "pending";
  amountEGP: number;
  fxRate: number | null;
  reason?: string;
}

/**
 * Pure conversion — reads only the stored fx_rate. NEVER resolves against
 * currency-buy rows at read time. Rows without an fx_rate for a non-EGP
 * currency are pending and excluded from all totals.
 */
export function computeExpenseEGP(e: ExpenseRow): ExpenseBreakdown {
  const amount = Number(e.amount || 0);
  const cur = (typeof e.currency === "string" && e.currency.trim() ? e.currency.trim().toUpperCase() : "EGP");
  if (cur === "EGP") return { status: "locked", amountEGP: amount, fxRate: 1 };
  const rate = Number(e.fx_rate || 0);
  if (rate > 0) return { status: "locked", amountEGP: amount * rate, fxRate: rate };
  return { status: "pending", amountEGP: 0, fxRate: null, reason: `لا يوجد سعر مثبت للعملة ${cur}` };
}

/**
 * Try to lock an expense's FX rate. WRITE-SIDE ONLY.
 *  - EGP → fx_rate = 1 (immediate lock).
 *  - Foreign → latest buy rate with tx_date <= expense.date; if none, stays
 *    pending. NO fallback to created_at or today.
 *  - Never overwrites an existing lock (guarded by fx_locked_at IS NULL).
 */
export async function ensureExpenseFxLock(
  sb: SB,
  e: ExpenseRow,
  buyRows?: CurrencyBuyRow[],
): Promise<{ fx_rate: number | null; updated: boolean; status: "locked" | "pending" }> {
  if (Number(e.fx_rate || 0) > 0) {
    return { fx_rate: Number(e.fx_rate), updated: false, status: "locked" };
  }
  const cur = (typeof e.currency === "string" && e.currency.trim() ? e.currency.trim().toUpperCase() : "EGP");
  const nowIso = new Date().toISOString();
  if (cur === "EGP") {
    const { data, error } = await sb
      .from("expenses")
      .update({ fx_rate: 1, fx_locked_at: nowIso })
      .eq("id", e.id)
      .is("fx_locked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { fx_rate: 1, updated: !!data, status: "locked" };
  }
  const onOrBefore = (e.date && String(e.date).length >= 8) ? String(e.date) : null;
  if (!onOrBefore) return { fx_rate: null, updated: false, status: "pending" };
  const rows = buyRows ?? (await loadCurrencyBuyRows(sb));
  const rate = resolveRateFromRows(rows, cur, onOrBefore);
  if (rate === null) return { fx_rate: null, updated: false, status: "pending" };
  const { data, error } = await sb
    .from("expenses")
    .update({ fx_rate: rate, fx_locked_at: nowIso })
    .eq("id", e.id)
    .is("fx_locked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { fx_rate: rate, updated: !!data, status: "locked" };
}

/** Lock any pending expense that uses `currency`. WRITE-SIDE ONLY. */
export async function lockPendingExpensesForCurrency(sb: SB, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EGP") return 0;
  const { data, error } = await sb
    .from("expenses")
    .select("id, date, created_at, amount, currency, exchange_rate, fx_rate, fx_locked_at")
    .eq("currency", cur)
    .is("fx_locked_at", null);
  if (error || !data) return 0;
  const rows = await loadCurrencyBuyRows(sb);
  let locked = 0;
  for (const e of data as any as ExpenseRow[]) {
    try {
      const r = await ensureExpenseFxLock(sb, e, rows);
      if (r.updated) locked += 1;
    } catch {
      // best-effort
    }
  }
  return locked;
}

