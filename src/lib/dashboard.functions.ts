import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY } from "@/lib/permissionKeys";

type Period = "today" | "week" | "month" | "year" | "all";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function hasExplicitViewPerm(perms: Record<string, any> | null | undefined, key: string) {
  const v = perms?.[key];
  if (v === true) return true;
  return !!(v && typeof v === "object" && (v.view === true || v.create === true || v.edit === true || v.delete === true || v.export === true));
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

function computeExecutionAgg(executions: any[], predicate: (ex: any) => boolean) {
  let sales = 0;
  let companyCost = 0;
  let agentCost = 0;
  for (const ex of executions) {
    if ((ex.operation_status || "") !== "منفذ") continue;
    if (!predicate(ex)) continue;
    const services = Array.isArray(ex.services) ? ex.services : [];
    for (const s of services) {
      if (!s || typeof s !== "object") continue;
      const count = Math.max(1, Math.round(Number(s.count) || 1));
      const agentPrice = Math.max(0, Number(s.agent_price) || 0);
      const companyPrice = Math.max(0, Number(s.company_price) || 0);
      const explicitCompanyValue = Math.max(0, Number(s.company_value) || 0);
      const companyValue = explicitCompanyValue > 0 ? explicitCompanyValue : companyPrice * count;
      const kind = (s as { kind?: string }).kind;
      if (kind === "company") {
        companyCost += companyValue;
      } else if (kind === "agent") {
        sales += agentPrice * count;
      } else {
        sales += agentPrice * count;
        if (s.company_id) companyCost += companyValue;
      }
    }
  }
  return { sales, companyCost, agentCost };
}

function expenseSum(expenses: any[], predicate: (row: any) => boolean) {
  let total = 0;
  for (const e of expenses) {
    if (!predicate(e)) continue;
    total += Number(e.amount || 0);
  }
  return total;
}

function inRange(d: string | null | undefined, range: { start: Date; end: Date }) {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

export const getDashboardProfitData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { period: Period; netProfit?: boolean; profitSummary?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const sb = admin();
    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("permissions, is_super_admin")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message || "تعذر التحقق من صلاحيات الأرباح");

    const permissions = ((profile as any)?.permissions ?? {}) as Record<string, any>;
    const isSuperAdmin = !!(profile as any)?.is_super_admin;
    const canNetProfit = isSuperAdmin || hasExplicitViewPerm(permissions, NET_PROFIT_PERMISSION_KEY);
    const canProfitSummary = isSuperAdmin || hasExplicitViewPerm(permissions, PROFIT_SUMMARY_PERMISSION_KEY);
    const wantsNetProfit = !!data.netProfit && canNetProfit;
    const wantsProfitSummary = !!data.profitSummary && canProfitSummary;

    if (!wantsNetProfit && !wantsProfitSummary) {
      return {
        canNetProfit,
        canProfitSummary,
        netProfit: null,
        profitSummary: null,
      };
    }

    const [{ data: executions, error: executionsError }, { data: expenses, error: expensesError }] = await Promise.all([
      sb.from("executions").select("id, created_at, operation_status, services"),
      sb.from("expenses").select("id, created_at, amount"),
    ]);
    if (executionsError) throw new Error(executionsError.message || "تعذر تحميل بيانات التنفيذات للأرباح");
    if (expensesError) throw new Error(expensesError.message || "تعذر تحميل بيانات المصروفات للأرباح");

    const executionRows = executions ?? [];
    const expenseRows = expenses ?? [];
    const allExec = computeExecutionAgg(executionRows, () => true);
    const expensesAll = expenseSum(expenseRows, () => true);
    const companyProfit = allExec.sales - allExec.companyCost - expensesAll;

    let netProfit: any = null;
    if (wantsNetProfit) {
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
      netProfit = { periodProfit, previousProfit, companyProfit };
    }

    const profitSummary = wantsProfitSummary
      ? {
          execSales: allExec.sales,
          execCompanyCost: allExec.companyCost,
          expensesAll,
          companyProfit,
        }
      : null;

    return { canNetProfit, canProfitSummary, netProfit, profitSummary };
  });
