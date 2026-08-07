import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  canViewProfitPermission,
  PROFIT_SUMMARY_PERMISSION_KEY,
  normalizePermissionsForLoad,
} from "@/lib/permissionKeys";
import {
  computeExecutionProfitEGP,
  computeExpenseEGP,
  type ExecutionRow,
  type ExpenseRow,
} from "@/lib/executionProfit";
import { cairoToday } from "@/lib/approvalFines";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

async function canViewProfitSummary(sb: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const [profileResult, roleResult] = await Promise.all([
    sb
      .from("profiles")
      .select("permissions, is_super_admin")
      .eq("id", userId)
      .maybeSingle(),
    sb.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  if (profileResult.error) throw new Error(profileResult.error.message || "تعذر التحقق من صلاحيات الأرباح");
  if (roleResult.error) throw new Error(roleResult.error.message || "تعذر التحقق من دور المستخدم");

  const profile = profileResult.data;
  const permissions = normalizePermissionsForLoad(
    (((profile as any)?.permissions ?? {}) as Record<string, unknown>),
  );
  return canViewProfitPermission(
    permissions,
    {
      roles: roleResult.data === true ? ["admin"] : [],
      isSuperAdmin: Boolean((profile as any)?.is_super_admin),
    },
    PROFIT_SUMMARY_PERMISSION_KEY,
  );
}

/**
 * ملخص أرباح الفترة للعرض فقط.
 * التنفيذات تستخدم created_at كما كان الداشبورد قبل تعديل الفلاتر.
 * المصروفات تستخدم created_at كما كان الداشبورد قبل تعديل الفلاتر.
 * التحويل إلى EGP يعتمد حصراً على أسعار الصرف التاريخية المقفلة.
 */
export const getDashboardPeriodProfitSummaryData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { period: SummaryPeriod }) => data)
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const allowed = await canViewProfitSummary(sb, context.userId);
    if (!allowed) return { canProfitSummary: false, profitSummary: null };

    const [executionResult, expenseResult] = await Promise.all([
      sb
        .from("executions")
        .select("id, created_at, financial_posting_date, operation_status, services, fx_locks, fx_locked_at"),
      sb
        .from("expenses")
        .select("id, created_at, date, amount, currency, exchange_rate, fx_rate, fx_locked_at"),
    ]);
    if (executionResult.error) {
      throw new Error(executionResult.error.message || "تعذر تحميل بيانات التنفيذات للأرباح");
    }
    if (expenseResult.error) {
      throw new Error(expenseResult.error.message || "تعذر تحميل بيانات المصروفات للأرباح");
    }

    const todayISO = cairoToday();
    let execSales = 0;
    let execCompanyCost = 0;
    let executionProfit = 0;
    let pendingExecutions = 0;

    for (const rawExecution of executionResult.data ?? []) {
      const execution = rawExecution as unknown as ExecutionRow & {
        financial_posting_date?: string | null;
        created_at?: string | null;
        operation_status?: string | null;
      };
      if (String(execution.operation_status || "").trim() !== "منفذ") continue;
      const accountingDate = execution.created_at || null;
      if (!isDateInSummaryPeriod(accountingDate, data.period, todayISO)) continue;

      const result = computeExecutionProfitEGP(execution);
      if (result.status !== "locked") {
        if (result.status === "pending") pendingExecutions += 1;
        continue;
      }
      execSales += result.salesEGP;
      execCompanyCost += result.companyCostEGP;
      executionProfit += result.profitEGP ?? 0;
    }

    let expenses = 0;
    let pendingExpenses = 0;
    for (const rawExpense of expenseResult.data ?? []) {
      const expense = rawExpense as unknown as ExpenseRow & {
        date?: string | null;
        created_at?: string | null;
      };
      const accountingDate = expense.created_at || null;
      if (!isDateInSummaryPeriod(accountingDate, data.period, todayISO)) continue;
      if (!Number(expense.amount || 0)) continue;

      const result = computeExpenseEGP(expense);
      if (result.status === "locked") expenses += result.amountEGP;
      else pendingExpenses += 1;
    }

    return {
      canProfitSummary: true,
      profitSummary: {
        execSales,
        execCompanyCost,
        expenses,
        netProfit: executionProfit - expenses,
        pendingExecutions,
        pendingExpenses,
      },
    };
  });
