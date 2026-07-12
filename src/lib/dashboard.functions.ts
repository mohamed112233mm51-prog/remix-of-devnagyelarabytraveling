import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { canViewProfitPermission, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, normalizePermissionsForLoad } from "@/lib/permissionKeys";
import {
  computeExecutionProfitEGP,
  lockPendingExecutions,
  loadCurrencyBuyRows,
  resolveRateFromRows,
  type ExecutionRow,
  type CurrencyBuyRow,
} from "@/lib/executionProfit";


type Period = "today" | "week" | "month" | "year" | "all";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function getProfitAuthorization(userId: string) {
  const sb = admin();
  const [profileResult, roleResult] = await Promise.all([
    sb
      .from("profiles")
      .select("permissions, is_super_admin")
      .eq("id", userId)
      .maybeSingle(),
    sb
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(profileResult.error.message || "تعذر التحقق من صلاحيات الأرباح");
  if (roleResult.error) throw new Error(roleResult.error.message || "تعذر التحقق من دور المستخدم");
  const profile = profileResult.data;
  const permissions = normalizePermissionsForLoad(((profile as any)?.permissions ?? {}) as Record<string, any>);
  const isSuperAdmin = !!(profile as any)?.is_super_admin;
  const roles = roleResult.data ? ["admin"] : [];
  return {
    sb,
    canNetProfit: canViewProfitPermission(permissions, { roles, isSuperAdmin }, NET_PROFIT_PERMISSION_KEY),
    canProfitSummary: canViewProfitPermission(permissions, { roles, isSuperAdmin }, PROFIT_SUMMARY_PERMISSION_KEY),
  };
}

async function loadProfitRows(sb: ReturnType<typeof admin>) {
  const [
    { data: executions, error: executionsError },
    { data: expenses, error: expensesError },
  ] = await Promise.all([
    sb
      .from("executions")
      .select("id, created_at, travel_date, operation_status, services, fx_locks, fx_locked_at"),
    sb
      .from("expenses")
      .select("id, created_at, date, amount, currency, exchange_rate"),
  ]);
  if (executionsError) throw new Error(executionsError.message || "تعذر تحميل بيانات التنفيذات للأرباح");
  if (expensesError) throw new Error(expensesError.message || "تعذر تحميل بيانات المصروفات للأرباح");

  // Load currency buy rows once — used for both lazy-locking pending executions
  // and for expense conversion (when an expense row does not carry its own rate).
  const buyRows: CurrencyBuyRow[] = await loadCurrencyBuyRows(sb);

  // Best-effort: lock any pending executions whose required rates are now
  // available. Existing locks are NEVER overwritten.
  const lockedExecutions = await lockPendingExecutions(sb, (executions ?? []) as ExecutionRow[]);

  return { executionRows: lockedExecutions, expenseRows: expenses ?? [], buyRows };
}


function getPeriodRange(period: Period, ref: Date = new Date()) {
  const start = new Date(ref);
  let end = new Date(ref);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (period === "week") {
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else if (period === "month") {
    start.setFullYear(ref.getFullYear(), ref.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setMonth(end.getMonth() + 1);
  } else if (period === "year") {
    start.setFullYear(ref.getFullYear(), 0, 1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
  } else {
    return { start: new Date(0), end: new Date(8.64e15) };
  }
  return { start, end };
}

function getPreviousRange(period: Period) {
  if (period === "all") return null;
  const { start, end } = getPeriodRange(period);
  const len = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - len), end: new Date(start.getTime()) };
}

/**
 * Aggregate execution profit IN EGP using the LOCKED per-execution FX rates.
 * Pending executions (rate not yet resolvable) are excluded from all totals.
 */
function computeExecutionAgg(executions: any[], predicate: (ex: any) => boolean) {
  let sales = 0;
  let companyCost = 0;
  let profit = 0;
  let pending = 0;
  for (const ex of executions) {
    if ((ex.operation_status || "") !== "منفذ") continue;
    if (!predicate(ex)) continue;
    const r = computeExecutionProfitEGP(ex as ExecutionRow);
    if (r.status !== "locked") {
      if (r.status === "pending") pending += 1;
      continue;
    }
    sales += r.salesEGP;
    companyCost += r.companyCostEGP;
    profit += r.profitEGP ?? 0;
  }
  return { sales, companyCost, profit, agentCost: 0, pending };
}

/**
 * Convert an expense row's amount to EGP using:
 *  1) the exchange_rate the user recorded on the expense (if present & > 0),
 *  2) otherwise the latest currency-buy rate with tx_date <= expense date.
 * Rows without any resolvable rate are treated as pending and skipped.
 */
function expenseSumEGP(
  expenses: any[],
  buyRows: CurrencyBuyRow[],
  predicate: (row: any) => boolean,
) {
  let total = 0;
  let pending = 0;
  for (const e of expenses) {
    if (!predicate(e)) continue;
    const amount = Number(e.amount || 0);
    if (amount === 0) continue;
    const cur = (typeof e.currency === "string" && e.currency.trim() ? e.currency.trim().toUpperCase() : "EGP");
    if (cur === "EGP") { total += amount; continue; }
    const explicit = Number(e.exchange_rate || 0);
    if (explicit > 0) { total += amount * explicit; continue; }
    const asOf = (typeof e.date === "string" && e.date.length >= 8)
      ? e.date
      : (typeof e.created_at === "string" ? e.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
    const rate = resolveRateFromRows(buyRows, cur, asOf);
    if (rate === null) { pending += 1; continue; }
    total += amount * rate;
  }
  return { total, pending };
}


function inRange(d: string | null | undefined, range: { start: Date; end: Date }) {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

export const getDashboardNetProfitData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { period: Period }) => d)
  .handler(async ({ context, data }) => {
    const { sb, canNetProfit } = await getProfitAuthorization(context.userId);
    if (!canNetProfit) {
      return { canNetProfit, netProfit: null };
    }

    const { executionRows, expenseRows } = await loadProfitRows(sb);
    const allExec = computeExecutionAgg(executionRows, () => true);
    const expensesAll = expenseSum(expenseRows, () => true);
    const companyProfit = allExec.sales - allExec.companyCost - expensesAll;

    const range = getPeriodRange(data.period);
    const prevRange = getPreviousRange(data.period);
    const periodExec = computeExecutionAgg(executionRows, (ex) => inRange(ex.created_at, range));
    const periodExpenses = expenseSum(expenseRows, (e) => inRange(e.created_at, range));
    const periodProfit = periodExec.sales - periodExec.companyCost - periodExpenses;
    let previousProfit: number | null = null;
    if (prevRange) {
      const prevExec = computeExecutionAgg(executionRows, (ex) => inRange(ex.created_at, prevRange));
      const prevExpenses = expenseSum(expenseRows, (e) => inRange(e.created_at, prevRange));
      previousProfit = prevExec.sales - prevExec.companyCost - prevExpenses;
    }

    return { canNetProfit, netProfit: { periodProfit, previousProfit, companyProfit } };
  });

export const getDashboardProfitSummaryData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sb, canProfitSummary } = await getProfitAuthorization(context.userId);
    if (!canProfitSummary) {
      return { canProfitSummary, profitSummary: null };
    }

    const { executionRows, expenseRows } = await loadProfitRows(sb);
    const allExec = computeExecutionAgg(executionRows, () => true);
    const expensesAll = expenseSum(expenseRows, () => true);
    const companyProfit = allExec.sales - allExec.companyCost - expensesAll;

    return {
      canProfitSummary,
      profitSummary: {
        execSales: allExec.sales,
        execCompanyCost: allExec.companyCost,
        expensesAll,
        companyProfit,
      },
    };
  });
