import { createFileRoute, Link } from "@tanstack/react-router";
import {
  fmtDL,
  fmtNum,
  merchantCashGross,
  merchantCashNet,
  tripValue,
  txnTotalPaid,
  useLive,
  type Agent,
  type Approval,
  type CompanyTransaction,
  type Expense,
  type ExpenseDeduction,
  type Flight,
  type Investor,
  type InvestorTransaction,
  type IssuingCompany,
  type Merchant,
  type MerchantCashCollection,
  type Transaction,
} from "@/lib/db";
import { useBranding, BRAND_NAVY, BRAND_GOLD } from "@/lib/branding";
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
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: flights } = useLive<Flight>("flights");
  const { rows: approvals } = useLive<Approval>("approvals");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: investors } = useLive<Investor>("investors");
  const { rows: invTxns } = useLive<InvestorTransaction>("investor_transactions");
  const { rows: expenses } = useLive<Expense>("expenses");
  const { rows: expenseDeductions } = useLive<ExpenseDeduction>("expense_deductions");

  const [period, setPeriod] = useState<Period>("month");

  // ===== Lifetime totals (kept for the "تفاصيل الأقسام" breakdown) =====
  const lifetime = useMemo(() => {
    const agentsFlightsValue = txns.filter((t) => t.service_type === "تذاكر طيران").reduce((s, t) => s + tripValue(t), 0);
    const agentsApprovalsValue = txns.filter((t) => t.service_type === "موافقة أمنية").reduce((s, t) => s + tripValue(t), 0);
    const agentsOtherValue = txns.filter((t) => t.service_type !== "تذاكر طيران" && t.service_type !== "موافقة أمنية").reduce((s, t) => s + tripValue(t), 0);
    const agentsTripValue = agentsFlightsValue + agentsApprovalsValue + agentsOtherValue;
    const agentsPaid = txns.reduce((s, t) => s + txnTotalPaid(t), 0);
    const agentsDue = agentsTripValue - agentsPaid;
    const agentCollectionsNet = txns.reduce((s, t) => s + Number(t.instapay_amount || 0) + Number(t.cash_amount || 0) + Number(t.merchant_cash_physical_amount || 0) + merchantCashNet(t), 0);
    const companyServices = cTxns.reduce((s, t) => s + (Number(t.trip_value || 0) || Number(t.count || 0) * Number(t.price || 0)), 0);
    const companyPaid = cTxns.reduce((s, t) => s + Number(t.instapay_amount || 0) + Number(t.cash_amount || 0) + merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0), 0);
    const companyDue = companyServices - companyPaid;
    const merchantIncomingNet = txns.reduce((s, t) => s + merchantCashNet(t), 0);
    const merchantIncomingGross = txns.reduce((s, t) => s + merchantCashGross(t), 0);
    const merchantOutgoing = cTxns.reduce((s, t) => s + Number(t.merchant_cash_amount || 0), 0);
    const merchantCollected = collections.reduce((s, c) => s + Number(c.amount || 0), 0);
    const merchantBalance = merchantIncomingNet - merchantOutgoing - merchantCollected;
    const merchantFee = merchantIncomingGross - merchantIncomingNet;
    const investorDeposits = invTxns.filter((t) => t.transaction_type === "توريد نقدية").reduce((s, t) => s + Number(t.amount || 0), 0);
    const investorWithdrawals = invTxns.filter((t) => t.transaction_type === "صرف نقدية").reduce((s, t) => s + Number(t.amount || 0), 0);
    const investorBalance = investorDeposits - investorWithdrawals;
    const expensesFixed = expenses.filter((e) => e.expense_type === "ثابت").reduce((s, e) => s + Number(e.amount || 0), 0);
    const expensesVariable = expenses.filter((e) => e.expense_type === "متغير").reduce((s, e) => s + Number(e.amount || 0), 0);
    const expensesDeducted = expenseDeductions.reduce((s, d) => s + Number(d.amount || 0), 0);
    const expensesAll = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const expensesTotal = expensesFixed + expensesVariable + expensesDeducted;
    const companyOutgoingNet = cTxns.reduce((s, t) => s + Number(t.instapay_amount || 0) + Number(t.cash_amount || 0) + merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0), 0);
    const companyProfit = agentCollectionsNet - companyOutgoingNet - expensesAll;
    const treasuryNet = agentCollectionsNet - companyOutgoingNet - expensesAll - expensesDeducted + investorBalance;
    return {
      agentsFlightsValue, agentsApprovalsValue, agentsTripValue, agentsPaid, agentsDue, agentCollectionsNet,
      companyServices, companyPaid, companyDue, merchantIncomingNet, merchantOutgoing, merchantFee, merchantBalance,
      investorDeposits, investorWithdrawals, investorBalance,
      expensesFixed, expensesVariable, expensesDeducted, expensesAll, expensesTotal,
      companyOutgoingNet, companyProfit, treasuryNet,
    };
  }, [txns, cTxns, collections, invTxns, expenses, expenseDeductions]);

  const {
    agentsFlightsValue, agentsApprovalsValue, agentsPaid, agentsDue, agentCollectionsNet,
    companyServices, companyPaid, companyDue, merchantIncomingNet, merchantOutgoing, merchantFee, merchantBalance,
    investorDeposits, investorWithdrawals, investorBalance,
    expensesFixed, expensesVariable, expensesDeducted, expensesAll, expensesTotal,
    companyOutgoingNet, companyProfit, treasuryNet,
  } = lifetime;

  // ===== Period-based aggregates =====
  const computeAgg = (range: { start: Date; end: Date }) => {
    const inR = (d?: string | null) => inRange(d, range);
    const t = txns.filter((x) => inR(x.created_at));
    const ct = cTxns.filter((x) => inR(x.created_at));
    const ex = expenses.filter((x) => inR(x.created_at));
    const ed = expenseDeductions.filter((x) => inR(x.created_at));
    const collected = t.reduce((s, x) => s + Number(x.instapay_amount || 0) + Number(x.cash_amount || 0) + Number(x.merchant_cash_physical_amount || 0) + merchantCashNet(x), 0);
    const compOut = ct.reduce((s, x) => s + Number(x.instapay_amount || 0) + Number(x.cash_amount || 0) + merchantCashNet(x) + Number(x.merchant_cash_physical_amount || 0), 0);
    const expSum = ex.reduce((s, x) => s + Number(x.amount || 0), 0) + ed.reduce((s, x) => s + Number(x.amount || 0), 0);
    const profit = collected - compOut - ex.reduce((s, x) => s + Number(x.amount || 0), 0);
    return {
      collected,
      expenses: expSum,
      profit,
      flightsCount: flights.filter((f) => inR(f.created_at)).length,
      approvalsCount: approvals.filter((a) => inR(a.created_at)).length,
    };
  };

  const periodRange = useMemo(() => getPeriodRange(period), [period]);
  const prevRange = useMemo(() => getPreviousRange(period), [period]);
  const periodAgg = useMemo(() => computeAgg(periodRange), [periodRange, txns, cTxns, expenses, expenseDeductions, flights, approvals]);
  const prevAgg = useMemo(() => (prevRange ? computeAgg(prevRange) : null), [prevRange, txns, cTxns, expenses, expenseDeductions, flights, approvals]);

  const periodLabel = PERIOD_LABELS[period];

  // Today's summary
  const today = new Date();
  const isToday = (d?: string) => {
    if (!d) return false;
    const dt = new Date(d);
    return dt.getFullYear() === today.getFullYear() && dt.getMonth() === today.getMonth() && dt.getDate() === today.getDate();
  };
  const todayTxns = txns.filter((t) => isToday(t.created_at));
  const todayCollected = todayTxns.reduce((s, t) => s + Number(t.instapay_amount || 0) + Number(t.cash_amount || 0) + Number(t.merchant_cash_physical_amount || 0) + merchantCashNet(t), 0);
  const todayValue = todayTxns.reduce((s, t) => s + tripValue(t), 0);
  const todayFlights = flights.filter((f) => isToday(f.created_at)).length;
  const todayApprovals = approvals.filter((a) => isToday(a.created_at)).length;

  // ===== Period-aware chart buckets =====
  const chart = useMemo(() => {
    const buckets: { label: string; value: number; isLast?: boolean }[] = [];
    const sumCollected = (range: { start: Date; end: Date }) =>
      txns.filter((t) => inRange(t.created_at, range)).reduce((s, t) => s + Number(t.instapay_amount || 0) + Number(t.cash_amount || 0) + Number(t.merchant_cash_physical_amount || 0) + merchantCashNet(t), 0);

    if (period === "today") {
      for (let h = 0; h < 24; h += 3) {
        const s = new Date(); s.setHours(h, 0, 0, 0);
        const e = new Date(s); e.setHours(h + 3);
        buckets.push({ label: `${h}`, value: sumCollected({ start: s, end: e }) });
      }
    } else if (period === "week") {
      const { start } = getPeriodRange("week");
      for (let i = 0; i < 7; i++) {
        const s = new Date(start); s.setDate(s.getDate() + i);
        const e = new Date(s); e.setDate(e.getDate() + 1);
        buckets.push({ label: s.toLocaleDateString("ar-EG", { weekday: "short" }), value: sumCollected({ start: s, end: e }) });
      }
    } else if (period === "month") {
      const { start, end } = getPeriodRange("month");
      const days = Math.round((end.getTime() - start.getTime()) / 86400000);
      for (let i = 0; i < days; i++) {
        const s = new Date(start); s.setDate(s.getDate() + i);
        const e = new Date(s); e.setDate(e.getDate() + 1);
        buckets.push({ label: `${s.getDate()}`, value: sumCollected({ start: s, end: e }) });
      }
    } else if (period === "year") {
      for (let m = 0; m < 12; m++) {
        const s = new Date(today.getFullYear(), m, 1);
        const e = new Date(today.getFullYear(), m + 1, 1);
        buckets.push({ label: s.toLocaleDateString("ar-EG", { month: "short" }), value: sumCollected({ start: s, end: e }) });
      }
    } else {
      // all: last 12 months trailing
      for (let i = 11; i >= 0; i--) {
        const s = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const e = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
        buckets.push({ label: s.toLocaleDateString("ar-EG", { month: "short" }), value: sumCollected({ start: s, end: e }) });
      }
    }
    if (buckets.length) buckets[buckets.length - 1].isLast = true;
    return buckets;
  }, [period, txns]);
  const chartMax = Math.max(...chart.map((b) => b.value), 1);
  const chartTotal = chart.reduce((s, b) => s + b.value, 0);

  // Recent activity (mix of txns, flights, approvals, expenses)
  type ActivityItem = { date: string; label: string; sub: string; tone: "blue" | "green" | "gold" | "red" | "navy" };
  const recent: ActivityItem[] = [
    ...txns.slice(0, 8).map<ActivityItem>((t) => ({
      date: t.created_at,
      label: `معاملة وكيل: ${t.service_type || ""}`,
      sub: `${fmtDL(tripValue(t))}`,
      tone: "blue",
    })),
    ...flights.slice(0, 4).map<ActivityItem>((f) => ({
      date: f.created_at,
      label: `رحلة جديدة`,
      sub: `حالة: ${f.status || "—"}`,
      tone: "navy",
    })),
    ...approvals.slice(0, 4).map<ActivityItem>((a) => ({
      date: a.created_at,
      label: `تقديم موافقة أمنية`,
      sub: `حالة: ${a.status || "—"}`,
      tone: "gold",
    })),
    ...expenses.slice(0, 4).map<ActivityItem>((e) => ({
      date: e.created_at,
      label: `مصروف: ${e.expense_type || ""}`,
      sub: `${fmtDL(Number(e.amount || 0))}`,
      tone: "red",
    })),
  ]
    .filter((x) => x.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 7);

  // Pending approvals
  const pendingApprovals = approvals.filter((a) => a.status && !["مكتمل", "منتهي", "مرفوض"].includes(a.status)).slice(0, 5);

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
        <HeroKpi
          label={`صافي الأرباح — ${periodLabel}`}
          value={fmtDL(periodAgg.profit)}
          icon={<TrendingUp size={18} />}
          tone="primary"
          delta={prevAgg ? `${pctDelta(periodAgg.profit, prevAgg.profit) >= 0 ? "+" : ""}${pctDelta(periodAgg.profit, prevAgg.profit)}%` : undefined}
          deltaPositive={prevAgg ? pctDelta(periodAgg.profit, prevAgg.profit) >= 0 : undefined}
          sub={prevAgg ? "مقارنة بالفترة السابقة" : "إجمالي النظام"}
        />
        <HeroKpi
          label={`إجمالي التحصيلات — ${periodLabel}`}
          value={fmtDL(periodAgg.collected)}
          icon={<HandCoins size={18} />}
          tone="success"
          delta={prevAgg ? `${pctDelta(periodAgg.collected, prevAgg.collected) >= 0 ? "+" : ""}${pctDelta(periodAgg.collected, prevAgg.collected)}%` : undefined}
          deltaPositive={prevAgg ? pctDelta(periodAgg.collected, prevAgg.collected) >= 0 : undefined}
          sub={prevAgg ? "مقارنة بالفترة السابقة" : undefined}
        />
        <HeroKpi
          label={`المصروفات — ${periodLabel}`}
          value={fmtDL(periodAgg.expenses)}
          icon={<Wallet size={18} />}
          tone="warning"
          delta={prevAgg ? `${pctDelta(periodAgg.expenses, prevAgg.expenses) >= 0 ? "+" : ""}${pctDelta(periodAgg.expenses, prevAgg.expenses)}%` : undefined}
          deltaPositive={prevAgg ? pctDelta(periodAgg.expenses, prevAgg.expenses) <= 0 : undefined}
          sub={prevAgg ? "مقارنة بالفترة السابقة" : undefined}
        />
        <HeroKpi
          label={`الرحلات — ${periodLabel}`}
          value={fmtNum(periodAgg.flightsCount)}
          icon={<Plane size={18} />}
          tone="navy"
          delta={prevAgg ? `${pctDelta(periodAgg.flightsCount, prevAgg.flightsCount) >= 0 ? "+" : ""}${pctDelta(periodAgg.flightsCount, prevAgg.flightsCount)}%` : undefined}
          deltaPositive={prevAgg ? pctDelta(periodAgg.flightsCount, prevAgg.flightsCount) >= 0 : undefined}
          sub={`الموافقات: ${fmtNum(periodAgg.approvalsCount)}`}
        />
      </div>

      {/* === Quick Actions + Today Summary === */}
      <div className="erp-row-2">
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Plus size={14} /> إجراءات سريعة</div>
          </div>
          <div className="erp-quick-actions">
            <QuickAction to="/flights" icon={<Plane size={16} />} label="إضافة رحلة" />
            <QuickAction to="/approvals" icon={<ClipboardCheck size={16} />} label="تقديم موافقة" />
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
            <TodayStat label="رحلات اليوم" value={fmtNum(todayFlights)} />
            <TodayStat label="موافقات اليوم" value={fmtNum(todayApprovals)} />
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
            <Link to="/approvals" className="erp-link">عرض الكل <ChevronLeft size={12} /></Link>
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
      <div className="erp-panel" style={{ marginTop: 14 }}>
        <div className="erp-panel-head">
          <div className="erp-panel-title"><Activity size={14} /> آخر العمليات</div>
        </div>
        <div className="erp-feed">
          {recent.length === 0 && <div className="erp-empty">لا توجد عمليات حديثة</div>}
          {recent.map((a, i) => (
            <div key={i} className={`erp-feed-row tone-${a.tone}`}>
              <div className="erp-feed-dot" />
              <div className="erp-feed-body">
                <div className="erp-feed-label">{a.label}</div>
                <div className="erp-feed-sub">{a.sub}</div>
              </div>
              <div className="erp-feed-time">{new Date(a.date).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}</div>
            </div>
          ))}
        </div>
      </div>

      {/* === Secondary breakdown === */}
      <div className="erp-section-title">تفاصيل الأقسام</div>
      <div className="dash-groups">
        <SectionCard title="الوكلاء" icon={<Users size={16} />} accent="navy">
          <Stat label="عدد الوكلاء" value={fmtNum(agents.length)} />
          <Stat label="قيمة الرحلات" value={fmtDL(agentsFlightsValue)} />
          <Stat label="قيمة الموافقات" value={fmtDL(agentsApprovalsValue)} />
          <Stat label="إجمالي المدفوعات" value={fmtDL(agentsPaid)} tone="green" />
          <Stat label="عدد الرحلات" value={fmtNum(flights.length)} />
          <Stat label="تقديمات الموافقات" value={fmtNum(approvals.length)} />
        </SectionCard>

        <SectionCard title="الشركات الصادرة" icon={<Building2 size={16} />} accent="navy">
          <Stat label="عدد الشركات" value={fmtNum(companies.length)} />
          <Stat label="إجمالي الخدمات" value={fmtDL(companyServices)} />
          <Stat label="المدفوعات" value={fmtDL(companyPaid)} tone="green" />
          <Stat label="المتبقي" value={fmtDL(companyDue)} tone="red" />
        </SectionCard>

        <SectionCard title="كاش التاجر" icon={<HandCoins size={16} />} accent="navy">
          <Stat label="عدد التجار" value={fmtNum(merchants.length)} />
          <Stat label="الوارد (صافي)" value={fmtDL(merchantIncomingNet)} tone="green" />
          <Stat label="الصادر" value={fmtDL(merchantOutgoing)} tone="red" />
          <Stat label="نسبة التاجر 1%" value={fmtDL(merchantFee)} />
          <Stat label="رصيد كاش التاجر" value={fmtDL(merchantBalance)} highlight />
        </SectionCard>

        <SectionCard title="المستثمرين" icon={<Briefcase size={16} />} accent="navy">
          <Stat label="عدد المستثمرين" value={fmtNum(investors.length)} />
          <Stat label="التوريدات" value={fmtDL(investorDeposits)} tone="green" />
          <Stat label="المسحوبات" value={fmtDL(investorWithdrawals)} tone="red" />
          <Stat label="صافي الأرصدة" value={fmtDL(investorBalance)} highlight />
        </SectionCard>

        <SectionCard title="المصروفات" icon={<Wallet size={16} />} accent="navy">
          <Stat label="الإجمالي" value={fmtDL(expensesTotal)} tone="red" />
          <Stat label="ثابتة" value={fmtDL(expensesFixed)} />
          <Stat label="متغيرة" value={fmtDL(expensesVariable)} />
          <Stat label="مخصومة" value={fmtDL(expensesDeducted)} />
        </SectionCard>

        <SectionCard title="ملخص الأرباح" icon={<TrendingUp size={16} />} accent="navy">
          <Stat label="التحصيلات الصافية" value={fmtDL(agentCollectionsNet)} tone="green" />
          <Stat label="مدفوعات الشركات" value={fmtDL(companyOutgoingNet)} tone="red" />
          <Stat label="إجمالي المصروفات" value={fmtDL(expensesAll)} tone="red" />
          <Stat label="صافي الأرباح" value={fmtDL(companyProfit)} highlight />
        </SectionCard>
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

function HeroKpi({
  label, value, icon, tone, sub, delta, deltaPositive,
}: {
  label: string; value: string; icon: ReactNode;
  tone: "primary" | "navy" | "success" | "warning";
  sub?: string; delta?: string; deltaPositive?: boolean;
}) {
  return (
    <div className={`erp-hero erp-hero-${tone}`}>
      <div className="erp-hero-top">
        <span className="erp-hero-label">{label}</span>
        <span className="erp-hero-icon">{icon}</span>
      </div>
      <div className="erp-hero-value">{value}</div>
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
}

function QuickAction({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="erp-qa">
      <span className="erp-qa-icon">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function TodayStat({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="erp-today">
      <div className="erp-today-label">{label}</div>
      <div className={`erp-today-value ${tone === "green" ? "tone-green" : ""}`}>{value}</div>
    </div>
  );
}

function SectionCard({
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
}

function Stat({
  label, value, tone, highlight,
}: { label: string; value: string; tone?: "gold" | "green" | "red"; highlight?: boolean }) {
  return (
    <div className={`dash-stat ${highlight ? "dash-stat-hl" : ""}`}>
      <div className="dash-stat-label">{label}</div>
      <div className={`dash-stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
    </div>
  );
}

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

/* ===== Responsive ===== */
@media (max-width:1100px){
  .erp-hero-grid{grid-template-columns:repeat(2,1fr)}
  .erp-row-2,.erp-row-chart{grid-template-columns:1fr}
}
@media (max-width:600px){
  .erp-hero-grid{grid-template-columns:1fr 1fr;gap:8px}
  .erp-hero{padding:11px 12px}
  .erp-hero-value{font-size:17px}
  .erp-quick-actions{grid-template-columns:repeat(2,1fr)}
  .erp-bars{height:130px}
  .dash-stats{grid-template-columns:1fr}
  .erp-feed-time{display:none}
}
`;
