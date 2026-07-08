import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { canViewProfitPermission, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY } from "@/lib/permissionKeys";
import { getDashboardNetProfitData, getDashboardProfitSummaryData } from "@/lib/dashboard.functions";
import {
  fmtDL,
  fmtNum,
  merchantCashGross,
  merchantCashNet,
  tripValue,
  txnTotalPaid,
  txnCollectedAmount,
  useLive,
  type Agent,
  type CompanyTransaction,
  type Expense,
  type ExpenseDeduction,
  type IssuingCompany,
  type Merchant,
  type MerchantCashCollection,
  type Submission,
  type Transaction,
} from "@/lib/db";
import { useBranding, BRAND_NAVY, BRAND_GOLD } from "@/lib/branding";
import { useExpensesTotals, computeTreasurySummary, computeTopAgentsByCollected } from "@/lib/financialSummary";
import {
  Users,
  Building2,
  HandCoins,
  Briefcase,
  Wallet,
  TrendingUp,
  Plane,
  ClipboardCheck,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Plus,
  ChevronLeft,
  Coins,
  Landmark,
  DollarSign,
} from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

export const Route = createFileRoute("/")({
  component: Dashboard,
});

type Period = "today" | "week" | "month" | "year" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
  year: "السنة الحالية",
  all: "إجمالي النظام",
};

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

function inRange(d: string | null | undefined, r: { start: Date; end: Date }) {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
}

function pctDelta(curr: number, prev: number) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / Math.abs(prev)) * 100);
}

function Dashboard() {
  const { user, roles, permissions, isSuperAdmin, profileLoaded } = useAuth();
  const queryClient = useQueryClient();
  // Profit cards are strict: super_admin/admin always see them; manager/user require an explicit true value.
  const canViewNetProfit = profileLoaded && canViewProfitPermission(permissions, { roles, isSuperAdmin }, NET_PROFIT_PERMISSION_KEY);
  const canViewProfitSummary = profileLoaded && canViewProfitPermission(permissions, { roles, isSuperAdmin }, PROFIT_SUMMARY_PERMISSION_KEY);
  const netProfitFn = useServerFn(getDashboardNetProfitData);
  const profitSummaryFn = useServerFn(getDashboardProfitSummaryData);
  const [period, setPeriod] = useState<Period>("month");
  const profitPermissionSignature = JSON.stringify({
    roles,
    owner: isSuperAdmin,
    net: permissions?.[NET_PROFIT_PERMISSION_KEY] ?? null,
    summary: permissions?.[PROFIT_SUMMARY_PERMISSION_KEY] ?? null,
    profileLoaded,
  });
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");
  const { rows: submissions } = useLive<Submission>("submissions");

  const executionMetricsQuery = useQuery({
    queryKey: ["dashboard-execution-metrics"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("executions")
        .select("id, created_at, operation_status, submission_id, services, destination")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; created_at: string | null; operation_status: string | null; submission_id: string | null; services: any; destination: string | null }[];
    },
  });
  const executionMetrics = executionMetricsQuery.data ?? [];
  const executedRows = useMemo(
    () => executionMetrics.filter((e) => (e.operation_status || "").trim() === "منفذ"),
    [executionMetrics],
  );

  const { rows: expenses } = useLive<Expense>("expenses");
  const { rows: expenseDeductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: currencyTxns } = useLive<{ id: string; supplier_id: string | null; tx_type: string | null; bought_currency: string | null; sold_currency: string | null; bought_amount: number | null; sold_amount: number | null; exchange_rate: number | null; tx_date: string; created_at: string; payment_splits: any }>("currency_supplier_transactions");
  const { rows: currencySuppliers } = useLive<{ id: string; status: string | null }>("currency_suppliers");

  const currencySupplierStats = useMemo(() => {
    const activeIds = new Set(
      currencySuppliers.filter((s) => (s.status || "نشط") === "نشط").map((s) => s.id),
    );
    let purchases = 0;
    let payments = 0;
    for (const t of currencyTxns) {
      if (!t.supplier_id || !activeIds.has(t.supplier_id)) continue;
      if ((t.tx_type || "") !== "شراء عملة") continue;
      purchases += Number(t.sold_amount || 0);
      const splits = Array.isArray(t.payment_splits) ? t.payment_splits : [];
      for (const s of splits) payments += Number((s && s.amount) || 0);
    }
    return {
      count: activeIds.size,
      purchases,
      payments,
      due: purchases - payments,
    };
  }, [currencyTxns, currencySuppliers]);

  // Heavy analytics use deferred period so KPI clicks feel instant
  const deferredPeriod = useDeferredValue(period);

  const netProfitQuery = useQuery({
    queryKey: ["dashboard-net-profit", period, profitPermissionSignature, canViewNetProfit],
    enabled: canViewNetProfit,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => netProfitFn({ data: { period } }),
  });
  const profitSummaryQuery = useQuery({
    queryKey: ["dashboard-profit-summary", profitPermissionSignature, canViewProfitSummary],
    enabled: canViewProfitSummary,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => profitSummaryFn(),
  });

  const effectiveCanViewNetProfit = canViewNetProfit && netProfitQuery.data?.canNetProfit === true;
  const effectiveCanViewProfitSummary = canViewProfitSummary && profitSummaryQuery.data?.canProfitSummary === true;

  useEffect(() => {
    if (canViewNetProfit) return;
    queryClient.removeQueries({ queryKey: ["dashboard-net-profit"] });
  }, [canViewNetProfit, queryClient]);

  useEffect(() => {
    if (canViewProfitSummary) return;
    queryClient.removeQueries({ queryKey: ["dashboard-profit-summary"] });
  }, [canViewProfitSummary, queryClient]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[dashboard:profit-permissions]", {
      email: user?.email ?? null,
      userId: user?.id ?? null,
      role: roles,
      is_super_admin: isSuperAdmin,
      profileLoaded,
      permissions_net_profit_view: permissions?.[NET_PROFIT_PERMISSION_KEY] ?? null,
      permissions_profit_summary_view: permissions?.[PROFIT_SUMMARY_PERMISSION_KEY] ?? null,
      decision_can_request_net_profit: canViewNetProfit,
      decision_can_request_profit_summary: canViewProfitSummary,
      server_can_net_profit: netProfitQuery.data?.canNetProfit ?? null,
      server_can_profit_summary: profitSummaryQuery.data?.canProfitSummary ?? null,
      final_render_net_profit_card: effectiveCanViewNetProfit,
      final_render_profit_summary_section: effectiveCanViewProfitSummary,
    });
  }, [user?.email, user?.id, roles, isSuperAdmin, profileLoaded, permissions, canViewNetProfit, canViewProfitSummary, netProfitQuery.data?.canNetProfit, profitSummaryQuery.data?.canProfitSummary, effectiveCanViewNetProfit, effectiveCanViewProfitSummary]);
  const netProfitData = effectiveCanViewNetProfit ? netProfitQuery.data?.netProfit : null;
  const profitSummaryData = effectiveCanViewProfitSummary ? profitSummaryQuery.data?.profitSummary : null;
  const periodProfit = netProfitData?.periodProfit ?? 0;
  const previousPeriodProfit = netProfitData?.previousProfit ?? null;
  const executionNetProfit = netProfitData?.companyProfit ?? profitSummaryData?.companyProfit ?? 0;
  const profitExecSales = profitSummaryData?.execSales ?? 0;
  const profitExecCompanyCost = profitSummaryData?.execCompanyCost ?? 0;
  const profitExpensesAll = profitSummaryData?.expensesAll ?? 0;

  // ===== Lifetime totals — single pass per table =====
  // Financial Summary Engine — إجماليات المصروفات موحّدة عبر المحرك.
  const expensesTotals = useExpensesTotals();

  const lifetime = useMemo(() => {
    let agentsFlightsValue = 0, agentsApprovalsValue = 0, agentsOtherValue = 0;
    let agentsPaid = 0, agentCollectionsNet = 0;
    let merchantIncomingNet = 0, merchantIncomingGross = 0;
    for (const t of txns) {
      const v = tripValue(t);
      if (t.service_type === "تذاكر طيران") agentsFlightsValue += v;
      else if (t.service_type === "موافقة أمنية") agentsApprovalsValue += v;
      else agentsOtherValue += v;
      agentsPaid += txnTotalPaid(t);
      const mcn = merchantCashNet(t);
      agentCollectionsNet += txnCollectedAmount(t);
      merchantIncomingNet += mcn;
      merchantIncomingGross += merchantCashGross(t);
    }
    const agentsTripValue = agentsFlightsValue + agentsApprovalsValue + agentsOtherValue;
    const agentsDue = agentsTripValue - agentsPaid;

    let companyServices = 0, companyOutgoingNet = 0, merchantOutgoing = 0;
    for (const t of cTxns) {
      companyServices += Number(t.trip_value || 0) || Number(t.count || 0) * Number(t.price || 0);
      companyOutgoingNet += txnCollectedAmount(t);
      merchantOutgoing += Number(t.merchant_cash_amount || 0);
    }
    const companyPaid = companyOutgoingNet;
    const companyDue = companyServices - companyPaid;

    let merchantCollected = 0;
    for (const c of collections) merchantCollected += Number(c.amount || 0);
    const merchantBalance = merchantIncomingNet - merchantOutgoing - merchantCollected;
    const merchantFee = merchantIncomingGross - merchantIncomingNet;

    // المصروفات: من المحرك الموحّد (نفس المنطق تماماً).
    const expensesFixed = expensesTotals.fixed;
    const expensesVariable = expensesTotals.variable;
    const expensesAll = expensesTotals.total;
    let expensesDeducted = 0;
    for (const d of expenseDeductions) expensesDeducted += Number(d.amount || 0);
    const expensesTotal = expensesFixed + expensesVariable + expensesDeducted;

    return {
      agentsFlightsValue, agentsApprovalsValue, agentsTripValue, agentsPaid, agentsDue, agentCollectionsNet,
      companyServices, companyPaid, companyDue, merchantIncomingNet, merchantOutgoing, merchantFee, merchantBalance,
      merchantCollected,
      expensesFixed, expensesVariable, expensesDeducted, expensesAll, expensesTotal,
      companyOutgoingNet,
    };
  }, [txns, cTxns, collections, expenseDeductions, expensesTotals]);

  const {
    agentsFlightsValue, agentsApprovalsValue, agentsTripValue, agentsPaid, agentsDue, agentCollectionsNet,
    companyServices, companyPaid, companyDue, merchantIncomingNet, merchantOutgoing, merchantFee, merchantBalance,
    merchantCollected,
    expensesFixed, expensesVariable, expensesDeducted, expensesAll, expensesTotal,
    companyOutgoingNet,
  } = lifetime;


  // Treasury balances (per currency from cash_boxes) + latest exchange rates
  // — كل الحساب من المحرك الموحد في src/lib/financialSummary.ts.
  const treasury = useMemo(
    () => computeTreasurySummary(cashBoxes, currencyTxns as any),
    [cashBoxes, currencyTxns],
  );

  // ===== Period-based aggregates — single pass per range =====
  const computeAgg = (range: { start: Date; end: Date }) => {
    const s = range.start.getTime(), e = range.end.getTime();
    const inR = (d?: string | null) => { if (!d) return false; const t = new Date(d).getTime(); return t >= s && t < e; };
    let collected = 0, compOut = 0, expSum = 0, expBase = 0, flightsCount = 0, approvalsCount = 0;
    for (const x of txns) {
      if (!inR(x.created_at)) continue;
      collected += txnCollectedAmount(x);
    }
    for (const x of cTxns) {
      if (!inR(x.created_at)) continue;
      compOut += txnCollectedAmount(x);
    }
    for (const x of expenses) {
      if (!inR(x.created_at)) continue;
      const a = Number(x.amount || 0); expSum += a; expBase += a;
    }
    for (const x of expenseDeductions) {
      if (!inR(x.created_at)) continue;
      expSum += Number(x.amount || 0);
    }
    for (const x of executedRows) if (inR(x.created_at)) flightsCount += 1;
    for (const a of submissions) if (inR(a.created_at)) approvalsCount += 1;
    return {
      collected,
      expenses: expSum,
      flightsCount,
      approvalsCount,
    };
  };


  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const prevRange = useMemo(() => getPreviousRange(period), [period]);
  const periodAgg = useMemo(() => computeAgg(periodRange), [periodRange, txns, cTxns, expenses, expenseDeductions, executedRows, submissions]);
  const prevAgg = useMemo(() => (prevRange ? computeAgg(prevRange) : null), [prevRange, txns, cTxns, expenses, expenseDeductions, executedRows, submissions]);



  const periodLabel = PERIOD_LABELS[period];

  // Today's summary — memoized (was recomputed every render)
  const todayStats = useMemo(() => {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const s = start.getTime(), e = end.getTime();
    const inToday = (d?: string | null) => { if (!d) return false; const t = new Date(d).getTime(); return t >= s && t < e; };
    let collected = 0, value = 0, execCount = 0, subCount = 0;
    for (const t of txns) {
      if (!inToday(t.created_at)) continue;
      collected += txnCollectedAmount(t);
      value += tripValue(t);
    }
    for (const x of executedRows) if (inToday(x.created_at)) execCount += 1;
    for (const x of submissions) if (inToday(x.created_at)) subCount += 1;
    return { todayCollected: collected, todayValue: value, todayExecutions: execCount, todaySubmissions: subCount, now };
  }, [txns, executedRows, submissions]);
  const { todayCollected, todayValue, todayExecutions, todaySubmissions, now: today } = todayStats;

  // ===== Period-aware chart — single pass binning =====
  const chart = useMemo(() => {
    const buckets: { label: string; value: number; isLast?: boolean; start: number; end: number }[] = [];
    const now = new Date();
    if (deferredPeriod === "today") {
      for (let h = 0; h < 24; h += 3) {
        const s = new Date(); s.setHours(h, 0, 0, 0);
        const e = new Date(s); e.setHours(h + 3);
        buckets.push({ label: `${h}`, value: 0, start: s.getTime(), end: e.getTime() });
      }
    } else if (deferredPeriod === "week") {
      const { start } = getPeriodRange("week");
      for (let i = 0; i < 7; i++) {
        const s = new Date(start); s.setDate(s.getDate() + i);
        const e = new Date(s); e.setDate(e.getDate() + 1);
        buckets.push({ label: s.toLocaleDateString("ar-EG", { weekday: "short" }), value: 0, start: s.getTime(), end: e.getTime() });
      }
    } else if (deferredPeriod === "month") {
      const { start, end } = getPeriodRange("month");
      const days = Math.round((end.getTime() - start.getTime()) / 86400000);
      for (let i = 0; i < days; i++) {
        const s = new Date(start); s.setDate(s.getDate() + i);
        const e = new Date(s); e.setDate(e.getDate() + 1);
        buckets.push({ label: `${s.getDate()}`, value: 0, start: s.getTime(), end: e.getTime() });
      }
    } else if (deferredPeriod === "year") {
      for (let m = 0; m < 12; m++) {
        const s = new Date(now.getFullYear(), m, 1);
        const e = new Date(now.getFullYear(), m + 1, 1);
        buckets.push({ label: s.toLocaleDateString("ar-EG", { month: "short" }), value: 0, start: s.getTime(), end: e.getTime() });
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ label: s.toLocaleDateString("ar-EG", { month: "short" }), value: 0, start: s.getTime(), end: e.getTime() });
      }
    }
    // single pass: bin every txn into the matching bucket
    const first = buckets[0]?.start ?? 0;
    const last = buckets[buckets.length - 1]?.end ?? 0;
    for (const t of txns) {
      if (!t.created_at) continue;
      const ts = new Date(t.created_at).getTime();
      if (ts < first || ts >= last) continue;
      // linear scan acceptable for small bucket counts (≤31)
      for (let i = 0; i < buckets.length; i++) {
        if (ts >= buckets[i].start && ts < buckets[i].end) {
          buckets[i].value += txnCollectedAmount(t);
          break;
        }
      }
    }
    if (buckets.length) buckets[buckets.length - 1].isLast = true;
    return buckets;
  }, [deferredPeriod, txns]);
  const chartMax = Math.max(...chart.map((b) => b.value), 1);
  const chartTotal = chart.reduce((s, b) => s + b.value, 0);

  // ===== ERP Analytics =====
  // 1. Top agents by collection
  const topAgents = useMemo(
    () => computeTopAgentsByCollected(txns, agents, 5),
    [txns, agents],
  );

  // 2. Top issuing companies by services provided — executions only (real executed work)
  const topCompanies = useMemo(() => {
    const byCo = new Map<string, { count: number; services: Map<string, number> }>();
    for (const ex of executedRows) {
      const services = Array.isArray((ex as any).services) ? (ex as any).services : [];
      for (const s of services) {
        if (!s || typeof s !== "object") continue;
        if ((s as any).kind !== "company") continue;
        const companyId = (s as any).company_id;
        if (!companyId) continue;
        const count = Math.max(1, Math.round(Number((s as any).count) || 1));
        const label = String((s as any).service_type || (s as any).type || (s as any).name || "—").trim() || "—";
        const cur = byCo.get(companyId) || { count: 0, services: new Map<string, number>() };
        cur.count += count;
        cur.services.set(label, (cur.services.get(label) || 0) + count);
        byCo.set(companyId, cur);
      }
    }
    const nameOf = new Map(companies.map((c) => [c.id, c.company_name]));
    return Array.from(byCo.entries())
      .map(([id, v]) => {
        let top = "—"; let max = 0;
        v.services.forEach((n, k) => { if (n > max) { max = n; top = k; } });
        return { id, name: nameOf.get(id) || "—", count: v.count, topService: top };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [executedRows, companies]);

  // 3. Service type distribution — executions only (real executed work)
  const serviceDist = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (label: string, n = 1) => {
      const k = label.trim();
      if (!k) return;
      counts.set(k, (counts.get(k) || 0) + n);
    };
    const extract = (svc: any) => {
      if (!Array.isArray(svc)) return;
      for (const s of svc) {
        if (!s) continue;
        if (typeof s === "string") { bump(s); continue; }
        const label = String((s as any).service_type || (s as any).type || (s as any).name || "").trim();
        if (!label) continue;
        const count = Math.max(1, Math.round(Number((s as any).count) || 1));
        bump(label, count);
      }
    };
    for (const ex of executedRows) extract((ex as any).services);
    const palette = [NAVY, GOLD, "#0EA5E9", "#10B981", "#EF4444", "#8B5CF6", "#F59E0B", "#14B8A6"];
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
    return entries.map(([label, value], i) => ({
      label,
      value,
      pct: Math.round((value / total) * 100),
      color: palette[i % palette.length],
    }));
  }, [executedRows]);
  const serviceTotal = serviceDist.reduce((s, x) => s + x.value, 0);

  // 4. Travel destinations — executions only; fallback to submission's destination when execution lacks one
  const topAuthorities = useMemo(() => {
    const destOfSub = new Map<string, string>();
    for (const s of submissions) {
      const d = ((s as any).destination || "").trim();
      if (d) destOfSub.set(s.id, d);
    }
    const byDest = new Map<string, number>();
    for (const ex of executedRows) {
      const direct = ((ex as any).destination || "").trim();
      const d = direct || (ex.submission_id ? destOfSub.get(ex.submission_id) || "" : "");
      if (!d) continue;
      byDest.set(d, (byDest.get(d) || 0) + 1);
    }
    const total = Array.from(byDest.values()).reduce((s, n) => s + n, 0) || 1;
    return Array.from(byDest.entries())
      .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [executedRows, submissions]);
  const authMax = Math.max(...topAuthorities.map((a) => a.count), 1);



  // Pending submissions — operation status not finalized
  const pendingApprovals = submissions
    .filter((a) => {
      const op = (a.operation_status || "").trim();
      return op && !["منفذ", "ملغي", "ملغى", "مكتمل"].includes(op);
    })
    .slice(0, 5);


  return (
    <div className="section active">
      <DashboardWelcome />

      {/* === Period filter === */}
      <div className="erp-period-bar">
        <span className="erp-period-label">الفترة:</span>
        <div className="erp-period-tabs">
          {(["today", "week", "month", "year", "all"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              className={`erp-period-tab ${period === p ? "is-active" : ""}`}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <span className="erp-period-current">{periodLabel}</span>
      </div>

      {/* === PRIMARY KPIs (hero) — period-based === */}
      <div className="erp-hero-grid">
        {effectiveCanViewNetProfit && (
        <HeroKpi
          label={`صافي الأرباح — ${periodLabel}`}
          value={periodProfit}
          format={fmtDL}
          icon={<TrendingUp size={18} />}
          tone="primary"
          delta={previousPeriodProfit !== null ? `${pctDelta(periodProfit, previousPeriodProfit) >= 0 ? "+" : ""}${pctDelta(periodProfit, previousPeriodProfit)}%` : undefined}
          deltaPositive={previousPeriodProfit !== null ? pctDelta(periodProfit, previousPeriodProfit) >= 0 : undefined}
          sub={previousPeriodProfit !== null ? "مقارنة بالفترة السابقة" : "إجمالي النظام"}
        />
        )}
        <HeroKpi
          label={`إجمالي التحصيلات — ${periodLabel}`}
          value={periodAgg.collected}
          format={fmtDL}
          icon={<HandCoins size={18} />}
          tone="success"
          delta={prevAgg ? `${pctDelta(periodAgg.collected, prevAgg.collected) >= 0 ? "+" : ""}${pctDelta(periodAgg.collected, prevAgg.collected)}%` : undefined}
          deltaPositive={prevAgg ? pctDelta(periodAgg.collected, prevAgg.collected) >= 0 : undefined}
          sub={prevAgg ? "مقارنة بالفترة السابقة" : undefined}
        />
        <HeroKpi
          label={`المصروفات — ${periodLabel}`}
          value={periodAgg.expenses}
          format={fmtDL}
          icon={<Wallet size={18} />}
          tone="warning"
          delta={prevAgg ? `${pctDelta(periodAgg.expenses, prevAgg.expenses) >= 0 ? "+" : ""}${pctDelta(periodAgg.expenses, prevAgg.expenses)}%` : undefined}
          deltaPositive={prevAgg ? pctDelta(periodAgg.expenses, prevAgg.expenses) <= 0 : undefined}
          sub={prevAgg ? "مقارنة بالفترة السابقة" : undefined}
        />
        <HeroKpi
          label={`التقديمات — ${periodLabel}`}
          value={submissions.filter((s) => inRange(s.created_at, periodRange)).length}
          format={fmtNum}
          icon={<ClipboardCheck size={18} />}
          tone="navy"
          sub={`التنفيذات: ${fmtNum(executionMetrics.filter((e) => inRange(e.created_at, periodRange)).length)}`}
        />
      </div>

      {/* === Treasury balances (cash boxes) === */}
      <div className="erp-section-title">أرصدة الخزائن</div>
      <div className="erp-hero-grid">
        <HeroKpi label="خزينة الجنيه المصري" value={treasury.egp} format={(n) => `${fmtNum(n)} ج.م`} icon={<Landmark size={18} />} tone="primary" sub="إجمالي رصيد EGP" />
        <HeroKpi label="خزينة الدولار الأمريكي" value={treasury.usd} format={(n) => `${fmtNum(n)} $`} icon={<DollarSign size={18} />} tone="success" sub="إجمالي رصيد USD" />
        <HeroKpi label="خزينة الدينار الليبي" value={treasury.lyd} format={(n) => `${fmtNum(n)} د.ل`} icon={<Coins size={18} />} tone="warning" sub="إجمالي رصيد LYD" />
        <HeroKpi label="إجمالي أرصدة الخزائن (ج.م)" value={treasury.totalEgp} format={(n) => `${fmtNum(n)} ج.م`} icon={<Wallet size={18} />} tone="navy" sub={`EGP + USD×${fmtNum(treasury.usdRate)} + LYD×${fmtNum(treasury.lydRate)}`} />
      </div>

      {/* === Treasuries audit panel === */}
      <div className="erp-panel" style={{ padding: 16, marginTop: 8 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>فحص إجمالي أرصدة الخزائن</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <AuditRow label="رصيد الخزينة المصرية" value={`${fmtNum(treasury.egp)} ج.م`} tone="success" />
          <AuditRow label="رصيد الخزينة الدولارية" value={`${fmtNum(treasury.usd)} $`} tone="success" />
          <AuditRow label="سعر شراء الدولار المستخدم" value={`${fmtNum(treasury.usdRate)} ج.م/$`} tone="warning" />
          <AuditRow label="رصيد الخزينة الدينار الليبي" value={`${fmtNum(treasury.lyd)} د.ل`} tone="success" />
          <AuditRow label="سعر شراء الدينار المستخدم" value={`${fmtNum(treasury.lydRate)} ج.م/د.ل`} tone="warning" />
          <AuditRow label="إجمالي أرصدة الخزائن (ج.م)" value={`${fmtNum(treasury.totalEgp)} ج.م`} tone="success" />
        </div>
      </div>

      {/* === System-wide KPIs === */}
      <div className="erp-section-title">المؤشرات الرئيسية</div>
      <div className="erp-hero-grid">
        <HeroKpi label="عدد التقديمات" value={submissions.length} format={fmtNum} icon={<ClipboardCheck size={18} />} tone="navy" />
        <HeroKpi label="عدد التنفيذات" value={executedRows.length} format={fmtNum} icon={<Plane size={18} />} tone="primary" />
        <HeroKpi label="إجمالي مبيعات الوكلاء" value={agentsTripValue} format={fmtDL} icon={<Users size={18} />} tone="success" />
        <HeroKpi label="إجمالي مستحقات الشركات الصادرة" value={companyDue} format={fmtDL} icon={<Building2 size={18} />} tone="warning" />
        <HeroKpi label="إجمالي تحصيلات الوكلاء" value={agentCollectionsNet} format={fmtDL} icon={<HandCoins size={18} />} tone="success" />
        <HeroKpi label="إجمالي تحصيلات تجار الكاش" value={merchantCollected} format={fmtDL} icon={<HandCoins size={18} />} tone="navy" />
        <HeroKpi label="إجمالي أرصدة الخزائن (ج.م)" value={treasury.totalEgp} format={fmtDL} icon={<Landmark size={18} />} tone="primary" />
        {effectiveCanViewNetProfit && (
          <HeroKpi label="صافي الربح من التنفيذات" value={executionNetProfit} format={fmtDL} icon={<TrendingUp size={18} />} tone="success" />
        )}
      </div>




      {/* === Quick Actions + Today Summary === */}
      <div className="erp-row-2">
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Plus size={14} /> إجراءات سريعة</div>
          </div>
          <div className="erp-quick-actions">
            <QuickAction to="/submissions" icon={<ClipboardCheck size={16} />} label="إضافة تقديم" />
            <QuickAction to="/executions" icon={<Plane size={16} />} label="تنفيذ جديد" />
            <QuickAction to="/accounts" icon={<Users size={16} />} label="حساب وكيل" />
            <QuickAction to="/companies" icon={<Building2 size={16} />} label="شركة صادرة" />
            <QuickAction to="/expenses" icon={<Wallet size={16} />} label="تسجيل مصروف" />
            <QuickAction to="/reports" icon={<TrendingUp size={16} />} label="التقارير" />
          </div>
        </div>

        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Activity size={14} /> ملخص اليوم</div>
            <span className="erp-chip">{today.toLocaleDateString("ar-EG")}</span>
          </div>
          <div className="erp-today-grid">
            <TodayStat label="تنفيذات اليوم" value={fmtNum(todayExecutions)} />
            <TodayStat label="تقديمات اليوم" value={fmtNum(todaySubmissions)} />
            <TodayStat label="قيمة معاملات اليوم" value={fmtDL(todayValue)} />
            <TodayStat label="تحصيلات اليوم" value={fmtDL(todayCollected)} tone="green" />
          </div>
        </div>
      </div>

      {/* === Revenue chart + Pending approvals === */}
      <div className="erp-row-chart">
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><TrendingUp size={14} /> التحصيلات — {periodLabel}</div>
            <span className="erp-chip erp-chip-strong">{fmtDL(chartTotal)}</span>
          </div>
          <div className="erp-bars">
            {chart.map((b, i) => {
              const h = Math.max(4, Math.round((b.value / chartMax) * 100));
              return (
                <div key={i} className="erp-bar-col">
                  <div className="erp-bar-val">{b.value ? fmtDL(b.value) : ""}</div>
                  <div className={`erp-bar ${b.isLast ? "is-last" : ""}`} style={{ height: `${h}%` }} />
                  <div className="erp-bar-day">{b.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><ClipboardCheck size={14} /> موافقات قيد التنفيذ</div>
            <Link to="/submissions" className="erp-link">عرض الكل <ChevronLeft size={12} /></Link>
          </div>
          <div className="erp-list">
            {pendingApprovals.length === 0 && <div className="erp-empty">لا توجد موافقات معلقة</div>}
            {pendingApprovals.map((a) => (
              <div key={a.id} className="erp-list-row">
                <div>
                  <div className="erp-list-title">تقديم #{String(a.id).slice(0, 6)}</div>
                  <div className="erp-list-sub">{a.created_at ? new Date(a.created_at).toLocaleDateString("ar-EG") : ""}</div>
                </div>
                <span className="erp-status">{a.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === Recent activity feed === */}
      {/* === ERP Analytics === */}
      <div className="erp-section-title">تحليلات الأداء</div>
      <div className="erp-analytics-grid">
        {/* 1. Top agents by collection */}
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Users size={14} /> أكثر الوكلاء تحصيلاً</div>
            <span className="erp-chip">أعلى 5</span>
          </div>
          <div className="erp-analytic-table">
            {topAgents.length === 0 && <div className="erp-empty">لا توجد بيانات</div>}
            {topAgents.map((a, i) => (
              <div key={a.id} className="erp-rank-row">
                <div className="erp-rank-no">{i + 1}</div>
                <div className="erp-rank-body">
                  <div className="erp-rank-name">{a.name}</div>
                  <div className="erp-rank-sub">{fmtNum(a.count)} عملية</div>
                </div>
                <div className="erp-rank-value tone-green">{fmtDL(a.collected)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Top issuing companies */}
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Building2 size={14} /> أكثر الشركات تقديمًا للخدمات</div>
            <span className="erp-chip">أعلى 5</span>
          </div>
          <div className="erp-analytic-table">
            {topCompanies.length === 0 && <div className="erp-empty">لا توجد بيانات</div>}
            {topCompanies.map((c, i) => (
              <div key={c.id} className="erp-rank-row">
                <div className="erp-rank-no">{i + 1}</div>
                <div className="erp-rank-body">
                  <div className="erp-rank-name">{c.name}</div>
                  <div className="erp-rank-sub">أكثر خدمة: {c.topService}</div>
                </div>
                <div className="erp-rank-value">{fmtNum(c.count)} طلب</div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Service type donut */}
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Briefcase size={14} /> توزيع أنواع الخدمات</div>
            <span className="erp-chip erp-chip-strong">{fmtNum(serviceTotal)}</span>
          </div>
          <div className="erp-donut-wrap">
            <Donut data={serviceDist} total={serviceTotal} />
            <div className="erp-donut-legend">
              {serviceDist.map((s) => (
                <div key={s.label} className="erp-legend-row">
                  <span className="erp-legend-dot" style={{ background: s.color }} />
                  <span className="erp-legend-label">{s.label}</span>
                  <span className="erp-legend-val">{s.pct}% · {fmtNum(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Travel authorities — horizontal bars */}
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Plane size={14} /> جهات السفر الأكثر استخدامًا</div>
            <span className="erp-chip">أعلى 6</span>
          </div>
          <div className="erp-hbar-list">
            {topAuthorities.length === 0 && <div className="erp-empty">لا توجد بيانات</div>}
            {topAuthorities.map((a) => (
              <div key={a.name} className="erp-hbar-row">
                <div className="erp-hbar-head">
                  <span className="erp-hbar-name">{a.name}</span>
                  <span className="erp-hbar-meta">{fmtNum(a.count)} رحلة · {a.pct}%</span>
                </div>
                <div className="erp-hbar-track">
                  <div className="erp-hbar-fill" style={{ width: `${Math.max(4, (a.count / authMax) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === Secondary breakdown === */}
      <div className="erp-section-title">تفاصيل الأقسام</div>
      <div className="dash-groups">
        <SectionCard title="الوكلاء" icon={<Users size={16} />} accent="navy">
          <Stat label="عدد الوكلاء" value={fmtNum(agents.filter((a: any) => (a.status || "نشط") === "نشط").length)} />
          <Stat label="قيمة الخدمات" value={fmtDL(agentsTripValue)} />
          <Stat label="إجمالي المدفوعات" value={fmtDL(agentsPaid)} tone="green" />
          <Stat label="المستحق" value={fmtDL(agentsDue)} tone="red" highlight />
        </SectionCard>

        <SectionCard title="الشركات الصادرة" icon={<Building2 size={16} />} accent="navy">
          <Stat label="عدد الشركات" value={fmtNum(companies.filter((c: any) => (c.status || "نشط") === "نشط").length)} />
          <Stat label="إجمالي الخدمات" value={fmtDL(companyServices)} />
          <Stat label="المدفوعات" value={fmtDL(companyPaid)} tone="green" />
          <Stat label="المتبقي" value={fmtDL(companyDue)} tone="red" />
        </SectionCard>

        <SectionCard title="تاجر الكاش" icon={<HandCoins size={16} />} accent="navy">
          <Stat label="عدد التجار" value={fmtNum(merchants.filter((m: any) => (m.status || "نشط") === "نشط").length)} />
          <Stat label="الوارد (صافي)" value={fmtDL(merchantIncomingNet)} tone="green" />
          <Stat label="الصادر" value={fmtDL(merchantOutgoing)} tone="red" />
          <Stat label="نسبة التاجر 1%" value={fmtDL(merchantFee)} />
          <Stat label="رصيد تاجر الكاش" value={fmtDL(merchantBalance)} highlight />
        </SectionCard>


        <SectionCard title="المصروفات" icon={<Wallet size={16} />} accent="navy">
          <Stat label="الإجمالي" value={fmtDL(expensesFixed + expensesVariable)} tone="red" />
          <Stat label="ثابتة" value={fmtDL(expensesFixed)} />
          <Stat label="متغيرة" value={fmtDL(expensesVariable)} />

        </SectionCard>


        <SectionCard title="موردو العملة" icon={<Landmark size={16} />} accent="navy">
          <Stat label="عدد الموردين" value={fmtNum(currencySupplierStats.count)} />
          <Stat label="إجمالي المشتريات" value={fmtDL(currencySupplierStats.purchases)} />
          <Stat label="إجمالي المدفوعات" value={fmtDL(currencySupplierStats.payments)} tone="green" />
          <Stat label="الرصيد المستحق" value={fmtDL(currencySupplierStats.due)} tone="red" highlight />
        </SectionCard>


        {effectiveCanViewProfitSummary && (
        <SectionCard title="ملخص الأرباح" icon={<TrendingUp size={16} />} accent="navy">
          <Stat label="إجمالي مبيعات الوكلاء" value={fmtDL(profitExecSales)} tone="green" />
          <Stat label="إجمالي تكلفة الشركات" value={fmtDL(profitExecCompanyCost)} tone="red" />
          <Stat label="إجمالي المصروفات" value={fmtDL(profitExpensesAll)} tone="red" />
          <Stat label="صافي الأرباح" value={fmtDL(profitSummaryData?.companyProfit ?? 0)} highlight />
        </SectionCard>
        )}
      </div>

      <style>{dashCss}</style>
    </div>
  );
}

function DashboardWelcome() {
  const branding = useBranding();
  const today = new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return (
    <div className="erp-welcome">
      <img src={branding.logoUrl} alt="" className="erp-welcome-logo" />
      <div className="erp-welcome-body">
        <div className="erp-welcome-title">{branding.companyName}</div>
        <div className="erp-welcome-sub">{today}</div>
      </div>
      <div className="erp-welcome-accent" />
    </div>
  );
}

function Donut({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const size = 160; const stroke = 22; const r = (size - stroke) / 2; const C = 2 * Math.PI * r;
  let offset = 0;
  const safeTotal = total > 0 ? total : 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="erp-donut-svg">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1F5F9" strokeWidth={stroke} />
      {data.map((d, i) => {
        const frac = d.value / safeTotal;
        const dash = frac * C;
        const el = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray .6s ease" }}
          />
        );
        offset += dash;
        return el;
      })}
      <text x="50%" y="46%" textAnchor="middle" fontSize="13" fontWeight="700" fill="#64748B">الإجمالي</text>
      <text x="50%" y="60%" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0F172A">{total.toLocaleString("ar-EG")}</text>
    </svg>
  );
}

function AnimatedNumber({
  value, format, duration = 900,
}: { value: number; format: (n: number) => string; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — smooth, enterprise feel
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, duration]);

  return <>{format(display)}</>;
}

const HeroKpi = memo(function HeroKpi({
  label, value, format, icon, tone, sub, delta, deltaPositive,
}: {
  label: string; value: number; format: (n: number) => string; icon: ReactNode;
  tone: "primary" | "navy" | "success" | "warning";
  sub?: string; delta?: string; deltaPositive?: boolean;
}) {
  return (
    <div className={`erp-hero erp-hero-${tone}`}>
      <div className="erp-hero-top">
        <span className="erp-hero-label">{label}</span>
        <span className="erp-hero-icon">{icon}</span>
      </div>
      <div className="erp-hero-value">
        <AnimatedNumber value={value} format={format} />
      </div>
      <div className="erp-hero-foot">
        {delta ? (
          <span className={`erp-hero-delta ${deltaPositive ? "up" : "down"}`}>
            {deltaPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {delta}
          </span>
        ) : null}
        {sub ? <span className="erp-hero-sub">{sub}</span> : null}
      </div>
    </div>
  );
});

const QuickAction = memo(function QuickAction({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="erp-qa">
      <span className="erp-qa-icon">{icon}</span>
      <span>{label}</span>
    </Link>
  );
});

const TodayStat = memo(function TodayStat({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="erp-today">
      <div className="erp-today-label">{label}</div>
      <div className={`erp-today-value ${tone === "green" ? "tone-green" : ""}`}>{value}</div>
    </div>
  );
});

const AuditRow = memo(function AuditRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  const color =
    tone === "success" ? "var(--green, #059669)" :
    tone === "danger" ? "var(--red, #dc2626)" :
    tone === "warning" ? "var(--gold, #b8923a)" :
    "var(--text)";
  return (
    <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted, #6b7280)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
});

const SectionCard = memo(function SectionCard({
  title, icon, accent, children,
}: { title: string; icon: ReactNode; accent: "navy" | "gold"; children: ReactNode }) {
  return (
    <div className={`dash-card dash-card-${accent}`}>
      <div className="dash-card-header">
        <div className="dash-card-icon">{icon}</div>
        <div className="dash-card-title">{title}</div>
      </div>
      <div className="dash-stats">{children}</div>
    </div>
  );
});

const Stat = memo(function Stat({
  label, value, tone, highlight,
}: { label: string; value: string; tone?: "gold" | "green" | "red"; highlight?: boolean }) {
  return (
    <div className={`dash-stat ${highlight ? "dash-stat-hl" : ""}`}>
      <div className="dash-stat-label">{label}</div>
      <div className={`dash-stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
    </div>
  );
});

const NAVY = BRAND_NAVY;
const GOLD = BRAND_GOLD;

const dashCss = `
/* ===== Welcome strip ===== */
.erp-welcome{display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,${NAVY} 0%,#1E3A5F 100%);color:#fff;border-radius:12px;padding:12px 16px;margin-bottom:14px;position:relative;overflow:hidden;box-shadow:0 4px 14px -8px rgba(15,27,61,.4)}
.erp-welcome-logo{width:42px;height:42px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.25))}
.erp-welcome-body{flex:1;min-width:0}
.erp-welcome-title{font-size:15px;font-weight:800;letter-spacing:.2px}
.erp-welcome-sub{font-size:11px;opacity:.78;margin-top:1px}
.erp-welcome-accent{position:absolute;inset-inline-end:-30px;top:-30px;width:140px;height:140px;border-radius:50%;background:radial-gradient(circle,${GOLD}33 0%,transparent 70%)}

/* ===== Period filter ===== */
.erp-period-bar{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:8px 12px;margin-bottom:12px;box-shadow:0 1px 2px rgba(15,23,42,.03);flex-wrap:wrap}
.erp-period-label{font-size:12px;font-weight:700;color:#64748B}
.erp-period-tabs{display:inline-flex;gap:4px;background:#F1F5F9;border-radius:9px;padding:3px}
.erp-period-tab{appearance:none;border:0;background:transparent;font:inherit;font-size:12px;font-weight:700;color:#64748B;padding:6px 12px;border-radius:7px;cursor:pointer;transition:all .15s ease}
.erp-period-tab:hover{color:${NAVY}}
.erp-period-tab.is-active{background:${NAVY};color:#fff;box-shadow:0 1px 3px rgba(15,27,61,.18)}
.erp-period-current{margin-inline-start:auto;font-size:11px;font-weight:700;color:${NAVY};background:#FEF3C7;border:1px solid #FCD34D;padding:3px 10px;border-radius:999px}

/* ===== Primary KPI hero ===== */
.erp-hero-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.erp-hero{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;position:relative;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;overflow:hidden}
.erp-hero:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(15,23,42,.06);border-color:#CBD5E1}
.erp-hero::before{content:"";position:absolute;top:0;inset-inline-start:0;width:3px;height:100%;background:var(--hero-accent,${NAVY})}
.erp-hero-primary{--hero-accent:${NAVY}}
.erp-hero-navy{--hero-accent:#1E3A5F}
.erp-hero-success{--hero-accent:#16A34A}
.erp-hero-warning{--hero-accent:${GOLD}}
.erp-hero-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.erp-hero-label{font-size:11.5px;font-weight:700;color:#64748B;letter-spacing:.2px}
.erp-hero-icon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--hero-accent) 10%,transparent);color:var(--hero-accent)}
.erp-hero-value{font-size:22px;font-weight:800;color:#0F172A;letter-spacing:-.3px;line-height:1.15}
.erp-hero-foot{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:#94A3B8}
.erp-hero-delta{display:inline-flex;align-items:center;gap:2px;padding:2px 7px;border-radius:999px;font-weight:700;font-size:10.5px}
.erp-hero-delta.up{background:#DCFCE7;color:#15803D}
.erp-hero-delta.down{background:#FEE2E2;color:#B91C1C}
.erp-hero-sub{font-weight:600;color:#64748B}

/* ===== Panels ===== */
.erp-panel{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;box-shadow:0 1px 2px rgba(15,23,42,.03)}
.erp-panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #F1F5F9}
.erp-panel-title{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#1E293B}
.erp-panel-title svg{color:${NAVY}}
.erp-chip{font-size:10.5px;color:#64748B;background:#F1F5F9;padding:3px 8px;border-radius:999px;font-weight:600}
.erp-chip-strong{color:${NAVY};background:#E0E7FF}
.erp-link{display:inline-flex;align-items:center;gap:2px;font-size:11.5px;color:${NAVY};font-weight:600;text-decoration:none}
.erp-link:hover{color:${GOLD}}

/* Two-column row */
.erp-row-2{display:grid;grid-template-columns:1.3fr 1fr;gap:12px;margin-bottom:14px}
.erp-row-chart{display:grid;grid-template-columns:1.6fr 1fr;gap:12px}

/* Quick actions */
.erp-quick-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.erp-qa{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #E2E8F0;border-radius:9px;background:#F8FAFC;color:#1E293B;text-decoration:none;font-size:12.5px;font-weight:600;transition:all .15s ease}
.erp-qa:hover{background:#fff;border-color:${NAVY};color:${NAVY};transform:translateY(-1px);box-shadow:0 2px 8px rgba(15,27,61,.08)}
.erp-qa-icon{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #E2E8F0;border-radius:7px;color:${NAVY}}

/* Today stats */
.erp-today-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.erp-today{padding:9px 11px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:9px}
.erp-today-label{font-size:11px;color:#64748B;font-weight:600;margin-bottom:3px}
.erp-today-value{font-size:15px;font-weight:800;color:#0F172A;letter-spacing:-.2px}
.erp-today-value.tone-green{color:#15803D}

/* Bar chart */
.erp-bars{display:flex;align-items:flex-end;gap:8px;height:160px;padding:6px 4px 0}
.erp-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%}
.erp-bar-val{font-size:9.5px;color:#94A3B8;font-weight:700;height:14px}
.erp-bar{width:100%;max-width:42px;background:linear-gradient(180deg,${NAVY} 0%,#1E3A5F 100%);border-radius:6px 6px 0 0;flex-shrink:0;transition:filter .2s ease;align-self:flex-end;margin-top:auto;min-height:4px}
.erp-bar.is-last{background:linear-gradient(180deg,${GOLD} 0%,#B8860B 100%)}
.erp-bar:hover{filter:brightness(1.1)}
.erp-bar-day{font-size:10.5px;color:#64748B;font-weight:600}

/* List rows */
.erp-list{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto}
.erp-list-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid #F1F5F9;border-radius:8px;background:#F8FAFC;transition:background .15s}
.erp-list-row:hover{background:#fff;border-color:#E2E8F0}
.erp-list-title{font-size:12.5px;font-weight:700;color:#1E293B}
.erp-list-sub{font-size:10.5px;color:#94A3B8;margin-top:2px}
.erp-status{font-size:10.5px;font-weight:700;color:${GOLD};background:#FEF3C7;padding:3px 9px;border-radius:999px;border:1px solid #FCD34D}
.erp-empty{padding:18px;text-align:center;color:#94A3B8;font-size:12px}

/* Activity feed */
.erp-feed{display:flex;flex-direction:column;gap:4px}
.erp-feed-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;transition:background .15s ease;border-bottom:1px solid #F1F5F9}
.erp-feed-row:last-child{border-bottom:none}
.erp-feed-row:hover{background:#F8FAFC}
.erp-feed-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#94A3B8}
.erp-feed-row.tone-blue .erp-feed-dot{background:#3B82F6}
.erp-feed-row.tone-green .erp-feed-dot{background:#16A34A}
.erp-feed-row.tone-gold .erp-feed-dot{background:${GOLD}}
.erp-feed-row.tone-red .erp-feed-dot{background:#DC2626}
.erp-feed-row.tone-navy .erp-feed-dot{background:${NAVY}}
.erp-feed-body{flex:1;min-width:0}
.erp-feed-label{font-size:12.5px;font-weight:700;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.erp-feed-sub{font-size:10.5px;color:#64748B;margin-top:1px}
.erp-feed-time{font-size:10.5px;color:#94A3B8;font-weight:600;flex-shrink:0;white-space:nowrap}

/* Section title */
.erp-section-title{font-size:13px;font-weight:700;color:#475569;margin:18px 0 10px;padding-inline-start:10px;border-inline-start:3px solid ${GOLD};line-height:1.2}

/* ===== Secondary section cards (compact) ===== */
.dash-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.dash-card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;box-shadow:0 1px 2px rgba(15,23,42,.03);transition:transform .18s ease,box-shadow .18s ease;position:relative;overflow:hidden}
.dash-card:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(15,23,42,.06)}
.dash-card::before{content:"";position:absolute;top:0;inset-inline-start:0;width:3px;height:100%;background:var(--accent,${NAVY})}
.dash-card-navy{--accent:${NAVY}}
.dash-card-gold{--accent:${GOLD}}
.dash-card-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #F1F5F9}
.dash-card-icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
.dash-card-title{font-size:13.5px;font-weight:800;color:#1E293B}
.dash-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.dash-stat{background:#F8FAFC;border:1px solid #F1F5F9;border-radius:8px;padding:8px 10px;transition:background .15s ease}
.dash-stat:hover{background:#fff;border-color:#E2E8F0}
.dash-stat-label{font-size:11px;color:#64748B;margin-bottom:3px;font-weight:600}
.dash-stat-value{font-size:14px;font-weight:800;color:#0F172A;letter-spacing:-.2px}
.dash-stat .tone-gold{color:${GOLD}}
.dash-stat .tone-green{color:#15803D}
.dash-stat .tone-red{color:#B91C1C}
.dash-stat-hl{background:#FFFBEB;border-color:#FDE68A}
.dash-stat-hl .dash-stat-value{font-size:15px;color:${GOLD}}

/* ===== ERP Analytics ===== */
.erp-analytics-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px}
.erp-analytic-table{display:flex;flex-direction:column;gap:6px}
.erp-rank-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid #F1F5F9;background:#F8FAFC;border-radius:9px;transition:all .15s ease}
.erp-rank-row:hover{background:#fff;border-color:#E2E8F0;transform:translateX(-2px)}
.erp-rank-no{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,${NAVY},#1E3A5F);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:800;flex-shrink:0}
.erp-rank-row:nth-child(1) .erp-rank-no{background:linear-gradient(135deg,${GOLD},#B8860B)}
.erp-rank-body{flex:1;min-width:0}
.erp-rank-name{font-size:12.5px;font-weight:700;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.erp-rank-sub{font-size:10.5px;color:#64748B;margin-top:2px}
.erp-rank-value{font-size:12.5px;font-weight:800;color:#0F172A;white-space:nowrap}
.erp-rank-value.tone-green{color:#15803D}

.erp-donut-wrap{display:flex;align-items:center;gap:18px;padding:6px 4px}
.erp-donut-svg{flex-shrink:0}
.erp-donut-legend{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.erp-legend-row{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#F8FAFC;border:1px solid #F1F5F9;border-radius:8px}
.erp-legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
.erp-legend-label{flex:1;font-size:12px;font-weight:700;color:#1E293B}
.erp-legend-val{font-size:11px;font-weight:700;color:#64748B}

.erp-hbar-list{display:flex;flex-direction:column;gap:11px}
.erp-hbar-row{display:flex;flex-direction:column;gap:4px}
.erp-hbar-head{display:flex;align-items:center;justify-content:space-between;font-size:11.5px}
.erp-hbar-name{font-weight:700;color:#1E293B}
.erp-hbar-meta{font-weight:600;color:#64748B}
.erp-hbar-track{height:10px;background:#F1F5F9;border-radius:6px;overflow:hidden}
.erp-hbar-fill{height:100%;background:linear-gradient(90deg,${NAVY} 0%,${GOLD} 100%);border-radius:6px;transition:width .6s ease}

/* ===== Responsive ===== */
@media (max-width:1100px){
  .erp-hero-grid{grid-template-columns:repeat(2,1fr)}
  .erp-row-2,.erp-row-chart{grid-template-columns:1fr}
  .erp-analytics-grid{grid-template-columns:1fr}
}
@media (max-width:600px){
  .erp-hero-grid{grid-template-columns:1fr 1fr;gap:8px}
  .erp-hero{padding:11px 12px}
  .erp-hero-value{font-size:17px}
  .erp-quick-actions{grid-template-columns:repeat(2,1fr)}
  .erp-bars{height:130px}
  .dash-stats{grid-template-columns:1fr}
  .erp-feed-time{display:none}
  .erp-donut-wrap{flex-direction:column;gap:12px}
}

/* ===== Premium ERP motion ===== */
@keyframes erp-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes erp-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes erp-bar-grow {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}
@keyframes erp-hbar-grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
@keyframes erp-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}

/* Hero KPI staggered entrance + refined hover */
.erp-hero{ animation: erp-fade-up .5s cubic-bezier(.22,1,.36,1) both; will-change: transform, opacity; }
.erp-hero-grid > .erp-hero:nth-child(1){ animation-delay: .04s; }
.erp-hero-grid > .erp-hero:nth-child(2){ animation-delay: .10s; }
.erp-hero-grid > .erp-hero:nth-child(3){ animation-delay: .16s; }
.erp-hero-grid > .erp-hero:nth-child(4){ animation-delay: .22s; }
.erp-hero{ transition: transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s ease, border-color .25s ease; }
.erp-hero:hover{ transform: translateY(-3px); box-shadow: 0 10px 26px -12px rgba(15,23,42,.18); }

/* Panels & welcome strip */
.erp-welcome{ animation: erp-fade-up .45s cubic-bezier(.22,1,.36,1) both; }
.erp-period-bar{ animation: erp-fade-up .45s cubic-bezier(.22,1,.36,1) both; animation-delay: .04s; }
.erp-panel{ animation: erp-fade-up .5s cubic-bezier(.22,1,.36,1) both; animation-delay: .12s; }
.erp-row-2 > .erp-panel:nth-child(2){ animation-delay: .18s; }
.erp-row-chart > .erp-panel:nth-child(2){ animation-delay: .18s; }
.erp-analytics-grid > .erp-panel:nth-child(1){ animation-delay: .14s; }
.erp-analytics-grid > .erp-panel:nth-child(2){ animation-delay: .20s; }
.erp-analytics-grid > .erp-panel:nth-child(3){ animation-delay: .26s; }
.erp-analytics-grid > .erp-panel:nth-child(4){ animation-delay: .32s; }
.dash-card{ animation: erp-fade-up .5s cubic-bezier(.22,1,.36,1) both; }
.dash-groups > .dash-card:nth-child(1){ animation-delay: .06s; }
.dash-groups > .dash-card:nth-child(2){ animation-delay: .12s; }
.dash-groups > .dash-card:nth-child(3){ animation-delay: .18s; }
.dash-groups > .dash-card:nth-child(4){ animation-delay: .24s; }
.dash-groups > .dash-card:nth-child(5){ animation-delay: .30s; }
.dash-groups > .dash-card:nth-child(6){ animation-delay: .36s; }

/* Chart bars — smooth progressive draw, anchored at bottom */
.erp-bar{
  transform-origin: bottom;
  animation: erp-bar-grow .75s cubic-bezier(.22,1,.36,1) both;
  transition: filter .2s ease, transform .25s ease;
}
.erp-bars > .erp-bar-col:nth-child(1) .erp-bar{ animation-delay: .05s; }
.erp-bars > .erp-bar-col:nth-child(2) .erp-bar{ animation-delay: .10s; }
.erp-bars > .erp-bar-col:nth-child(3) .erp-bar{ animation-delay: .15s; }
.erp-bars > .erp-bar-col:nth-child(4) .erp-bar{ animation-delay: .20s; }
.erp-bars > .erp-bar-col:nth-child(5) .erp-bar{ animation-delay: .25s; }
.erp-bars > .erp-bar-col:nth-child(6) .erp-bar{ animation-delay: .30s; }
.erp-bars > .erp-bar-col:nth-child(7) .erp-bar{ animation-delay: .35s; }
.erp-bars > .erp-bar-col:nth-child(8) .erp-bar{ animation-delay: .40s; }
.erp-bars > .erp-bar-col:nth-child(9) .erp-bar{ animation-delay: .45s; }
.erp-bars > .erp-bar-col:nth-child(10) .erp-bar{ animation-delay: .50s; }
.erp-bars > .erp-bar-col:nth-child(11) .erp-bar{ animation-delay: .55s; }
.erp-bars > .erp-bar-col:nth-child(12) .erp-bar{ animation-delay: .60s; }
.erp-bar:hover{ filter: brightness(1.12); transform: scaleY(1.02); }

/* Horizontal bar fills — draw from inline-start (RTL = right) */
.erp-hbar-fill{
  transform-origin: right;
  animation: erp-hbar-grow .85s cubic-bezier(.22,1,.36,1) both;
}
.erp-hbar-list > .erp-hbar-row:nth-child(1) .erp-hbar-fill{ animation-delay: .08s; }
.erp-hbar-list > .erp-hbar-row:nth-child(2) .erp-hbar-fill{ animation-delay: .14s; }
.erp-hbar-list > .erp-hbar-row:nth-child(3) .erp-hbar-fill{ animation-delay: .20s; }
.erp-hbar-list > .erp-hbar-row:nth-child(4) .erp-hbar-fill{ animation-delay: .26s; }
.erp-hbar-list > .erp-hbar-row:nth-child(5) .erp-hbar-fill{ animation-delay: .32s; }
.erp-hbar-list > .erp-hbar-row:nth-child(6) .erp-hbar-fill{ animation-delay: .38s; }

/* Lists & ranking rows — gentle staggered fade-in */
.erp-rank-row,
.erp-list-row,
.erp-legend-row,
.erp-feed-row{
  animation: erp-fade-up .42s cubic-bezier(.22,1,.36,1) both;
}
.erp-analytic-table > .erp-rank-row:nth-child(1){ animation-delay: .05s; }
.erp-analytic-table > .erp-rank-row:nth-child(2){ animation-delay: .10s; }
.erp-analytic-table > .erp-rank-row:nth-child(3){ animation-delay: .15s; }
.erp-analytic-table > .erp-rank-row:nth-child(4){ animation-delay: .20s; }
.erp-analytic-table > .erp-rank-row:nth-child(5){ animation-delay: .25s; }
.erp-list > .erp-list-row:nth-child(1){ animation-delay: .05s; }
.erp-list > .erp-list-row:nth-child(2){ animation-delay: .10s; }
.erp-list > .erp-list-row:nth-child(3){ animation-delay: .15s; }
.erp-list > .erp-list-row:nth-child(4){ animation-delay: .20s; }
.erp-list > .erp-list-row:nth-child(5){ animation-delay: .25s; }
.erp-list > .erp-list-row:nth-child(6){ animation-delay: .30s; }

/* Donut — soft fade-in (avoid spinning per brief) */
.erp-donut-svg{ animation: erp-fade-in .6s ease-out both; animation-delay: .15s; }

/* Quick actions — refined hover */
.erp-qa{ transition: transform .2s cubic-bezier(.22,1,.36,1), background .2s ease, border-color .2s ease, box-shadow .25s ease, color .2s ease; }
.erp-qa:hover{ transform: translateY(-2px) scale(1.015); }
.erp-qa:active{ transform: translateY(0) scale(.99); }

/* Period tabs — smoother active swap */
.erp-period-tab{ transition: background .22s ease, color .22s ease, box-shadow .22s ease, transform .15s ease; }
.erp-period-tab:active{ transform: scale(.97); }

/* Today / dash stat hover lift */
.erp-today{ transition: background .2s ease, transform .2s ease, border-color .2s ease; }
.erp-today:hover{ transform: translateY(-1px); background: #fff; }
.dash-stat{ transition: background .2s ease, transform .2s ease, border-color .2s ease; }
.dash-stat:hover{ transform: translateY(-1px); }

/* Reduced motion — respect user preference */
@media (prefers-reduced-motion: reduce){
  .erp-hero, .erp-panel, .dash-card, .erp-welcome, .erp-period-bar,
  .erp-bar, .erp-hbar-fill, .erp-rank-row, .erp-list-row,
  .erp-legend-row, .erp-feed-row, .erp-donut-svg{
    animation: none !important;
  }
  .erp-hero:hover, .erp-qa:hover, .dash-card:hover,
  .erp-today:hover, .dash-stat:hover{ transform: none !important; }
}
`;
