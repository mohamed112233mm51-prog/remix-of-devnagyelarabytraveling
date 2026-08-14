import { createFileRoute } from "@tanstack/react-router";
import { CASH_BOX_SETTLEMENT_PERMISSION_KEY, usePerm } from "@/hooks/usePerm";
import { CurrencyLines } from "@/components/CurrencyLines";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import { EditTransactionButton } from "@/components/EditTransactionButton";
import { useMemo, useState } from "react";
import {
  fmtDL,
  fmtNum,
  fmtUSD,
  formatExchangeRate,
  tripValue,
  txnTotalPaid,
  txnCollectedAmount,
  refetchLiveTables,
  useLive,
  type UsdTreasuryTransaction,
} from "@/lib/db";
import { useReportsData, type ReportsData } from "@/lib/reportsData";
import { computeServiceExecutionDistribution, normalizeServiceType } from "@/lib/serviceDistribution";
import { summarizeExpenses, summarizeCurrencySupplierTrades, computeTreasurySummary, activeCashBoxes, summarizeMerchantReport, summarizeInvestorReport, summarizeUsdTreasuryPeriod, formatCurrencyMap, CurrencyMap, useCompaniesSummary } from "@/lib/financialSummary";
import { computeAgentReport } from "@/lib/sectionAccounting/agentsReport";
import { computeCompanyReport } from "@/lib/sectionAccounting/companiesReport";
import { logReconciliation } from "@/lib/sectionAccounting/reconciliation";
import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";
import { useEffect } from "react";
import { exportStatementToExcel, exportStatementToPDF } from "@/lib/exportStatement";
import { toDisplayDate } from "@/lib/dateFormat";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { syncCashBoxOpeningBalance } from "@/lib/openingBalance";
import { checkOutflowAllowed, postCashBoxTransfer, postMovement } from "@/lib/financialEngine";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  BarChart3, Users, Building2, Handshake, Briefcase, Plane, ShieldCheck, Receipt,
  Calendar, RefreshCw, FileSpreadsheet, FileText, TrendingUp, TrendingDown, Wallet, Activity, DollarSign,
} from "lucide-react";

export const Route = createFileRoute("/reports")({
  component: () => <AppErrorBoundary><ReportsPage /></AppErrorBoundary>,
  errorComponent: () => <div className="card" style={{ padding: 24 }}>تعذر تحميل التقارير مؤقتًا. <button className="btn btn-gold" onClick={() => window.location.reload()}>إعادة المحاولة</button></div>,
});

type Tab = "agents" | "companies" | "merchants" | "expenses" | "treasuries" | "currency_suppliers";
type Period = "30d" | "1y" | "all" | "custom";

// Professional, soft palette
const COLORS = {
  income: "#2563EB",     // blue — collections / income
  positive: "#16A34A",   // green — positive balances
  negative: "#DC2626",   // red — dues / expenses
  warning: "#F59E0B",    // orange — fees / warnings
  investor: "#7C3AED",   // purple — investors
  sky: "#0EA5E9",
  amber: "#D97706",
};
const CHART_COLORS = [COLORS.income, COLORS.positive, COLORS.warning, COLORS.negative, COLORS.investor, COLORS.sky, COLORS.amber, "#0891B2"];

const fmtMoneyTip = (v: number) => `${Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;
const fmtCount = (v: number) => Number(v || 0).toLocaleString("en-US");

function ChartCard({
  title,
  subtitle,
  isEmpty,
  height = 300,
  children,
}: {
  title: string;
  subtitle?: string;
  isEmpty?: boolean;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="card chart-card">
      <div className="chart-card-header">
        <div className="chart-card-title">{title}</div>
        {subtitle && <div className="chart-card-subtitle">{subtitle}</div>}
      </div>
      <div className="chart-card-body">
        {isEmpty ? (
          <div className="chart-empty" style={{ minHeight: height }}>
            <div className="chart-empty-icon">📊</div>
            <div className="chart-empty-text">لا توجد بيانات للفترة المحددة</div>
          </div>
        ) : (
          <div style={{ width: "100%", height }} dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              {children as React.ReactElement}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartsGrid({ children }: { children: React.ReactNode; cols?: number }) {
  return <div className="charts-grid">{children}</div>;
}

function KpiRow({ items }: { items: { label: string; value: React.ReactNode; tone?: "green" | "red" | "gold" | ""; icon?: React.ReactNode; sub?: string }[] }) {
  const defaultIcon = (tone?: string) => {
    if (tone === "green") return <TrendingUp size={20} strokeWidth={2} />;
    if (tone === "red") return <TrendingDown size={20} strokeWidth={2} />;
    if (tone === "gold") return <Wallet size={20} strokeWidth={2} />;
    return <Activity size={20} strokeWidth={2} />;
  };
  return (
    <div className="account-summary kpi-rich" style={{ marginBottom: 16 }}>
      {items.map((k, i) => (
        <div key={i} className={`sum-box ${k.tone || ""}`}>
          <span className="kpi-icon">{k.icon || defaultIcon(k.tone)}</span>
          <div className="kpi-text">
            <div className="label">{k.label}</div>
            <div className="val">{k.value}</div>
            {k.sub && <div className="kpi-sub">{k.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyOrLoading({ loading, label, colSpan }: { loading: boolean; label: string; colSpan: number }) {
  return (
    <tr><td colSpan={colSpan}><div className="empty"><div className="empty-text">{loading ? "جارٍ التحميل..." : label}</div></div></td></tr>
  );
}

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card, #fff)",
  boxShadow: "0 6px 22px rgba(0,0,0,.08)",
  fontFamily: "inherit",
  fontSize: 12,
  padding: "8px 10px",
} as const;
const tooltipLabelStyle = { fontWeight: 700, marginBottom: 4 } as const;
const fmtTip = (v: number) => fmtMoneyTip(v);
const axisTick = { fontSize: 11, fill: "var(--text3, #6b7280)" } as const;
const gridStroke = "rgba(0,0,0,.06)";

const chartsCss = `
.charts-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}
@media (max-width:780px){.charts-grid{grid-template-columns:1fr}}
.chart-card{border-radius:16px;box-shadow:0 4px 18px rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.05);background:var(--card,#fff);display:flex;flex-direction:column;overflow:hidden;transition:box-shadow .2s ease, transform .2s ease}
.chart-card:hover{box-shadow:0 10px 28px rgba(0,0,0,.08);transform:translateY(-2px)}
.chart-card-header{padding:16px 18px 6px}
.chart-card-title{font-size:15px;font-weight:800;color:var(--text1,#111827);letter-spacing:-.2px}
.chart-card-subtitle{font-size:12px;color:var(--text3,#6b7280);margin-top:2px;font-weight:500}
.chart-card-body{padding:6px 10px 14px;flex:1;display:flex;flex-direction:column;justify-content:center}
.chart-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--text3,#6b7280);text-align:center;padding:24px}
.chart-empty-icon{font-size:32px;opacity:.5}
.chart-empty-text{font-size:13px;font-weight:600}
.recharts-default-legend{font-size:12px !important}
.recharts-legend-item-text{color:var(--text2,#374151) !important;font-weight:600}

/* Filter toolbar */
.reports-page .filter-toolbar-card{border-radius:14px;border:1px solid #E5E9F0;background:linear-gradient(180deg,#FBFCFE,#F4F6FA);box-shadow:0 1px 2px rgba(15,23,42,.04);margin-bottom:16px}
.reports-page .filter-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.reports-page .filter-presets{display:flex;flex-wrap:wrap;gap:6px}
.reports-page .preset-chip{height:34px;padding:0 12px;border-radius:999px;border:1px solid #E2E7F0;background:#fff;color:#475569;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:6px}
.reports-page .preset-chip:hover{border-color:#CBD5E1;color:#0F172A;background:#F8FAFC}
.reports-page .preset-chip.active{background:linear-gradient(180deg,#F5C542,#D9A82E);color:#1F1A0A;border-color:#C9991F;box-shadow:0 1px 2px rgba(217,168,46,.35)}
.reports-page .filter-range{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.reports-page .range-field{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:36px;background:#fff;border:1px solid #E2E7F0;border-radius:10px;color:#64748B;font-size:12.5px}
.reports-page .range-field label{font-weight:700;color:#334155;font-size:12px}
.reports-page .range-field input{border:none;outline:none;background:transparent;font-size:12.5px;color:#0F172A;padding:0;min-width:118px}
.reports-page .filter-range .action-btn{height:36px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:10px}

/* Export bar */
.reports-page .export-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.reports-page .export-btn{height:36px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;border-radius:10px;border:1px solid #E2E7F0;background:#fff;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .15s ease}
.reports-page .export-btn:hover{border-color:#CBD5E1;background:#F8FAFC;color:#0F172A}
.reports-page .export-btn--excel{background:linear-gradient(180deg,#16A34A,#15803D);border-color:#15803D;color:#fff}
.reports-page .export-btn--excel:hover{filter:brightness(1.05);color:#fff}

@media (max-width:780px){
  .reports-page .filter-toolbar{flex-direction:column;align-items:stretch}
  .reports-page .filter-range{justify-content:flex-start}
  .reports-page .range-field input{min-width:0;flex:1}
}
`;

function ReportsPage() {
  const [tab, setTab] = useState<Tab>("agents");
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const def30 = iso(new Date(today.getTime() - 30 * 86400000));
  const def365 = iso(new Date(today.getTime() - 365 * 86400000));

  const [period, setPeriod] = useState<Period>("30d");
  const [from, setFrom] = useState(def30);
  const [to, setTo] = useState(iso(today));

  const applyPeriod = (p: Period) => {
    setPeriod(p);
    if (p === "30d") { setFrom(def30); setTo(iso(today)); }
    else if (p === "1y") { setFrom(def365); setTo(iso(today)); }
    else if (p === "all") { setFrom(""); setTo(""); }
  };

  const applyToday = () => { const t = iso(today); setFrom(t); setTo(t); setPeriod("custom"); };
  const apply7d = () => { setFrom(iso(new Date(today.getTime() - 7 * 86400000))); setTo(iso(today)); setPeriod("custom"); };
  const applyThisMonth = () => {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    setFrom(iso(first)); setTo(iso(today)); setPeriod("custom");
  };

  const inRange = (d: string | null | undefined) =>
    (!from || (d ?? "") >= from) && (!to || (d ?? "") <= to);

  const data = useReportsData();

  if (typeof window !== "undefined") {
    console.log("[Reports] period:", period, "from:", from, "to:", to, "flights:", data.flights.length, "approvals:", data.approvals.length, "loading:", data.loading);
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "agents", label: "الوكلاء", icon: <Users size={15} strokeWidth={2} /> },
    { id: "companies", label: "الشركات الصادرة", icon: <Building2 size={15} strokeWidth={2} /> },
    { id: "merchants", label: "تاجر الكاش", icon: <Handshake size={15} strokeWidth={2} /> },
    { id: "expenses", label: "المصروفات", icon: <Receipt size={15} strokeWidth={2} /> },
    { id: "treasuries", label: "الخزائن", icon: <Wallet size={15} strokeWidth={2} /> },
    { id: "currency_suppliers", label: "شراء وبيع العملات", icon: <DollarSign size={15} strokeWidth={2} /> },
  ];

  return (
    <div className="section active fin-page accounts-page reports-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>التحليلات</span>
            <span>›</span>
            <span className="crumb-current">التقارير والإحصائيات</span>
          </div>
          <h1 className="page-h1"><BarChart3 size={22} strokeWidth={2.2} /> التقارير والإحصائيات</h1>
          <div className="page-sub">تحليلات وتقارير الأداء المالي والتشغيلي للنظام</div>
        </div>
      </div>

      <div className="action-toolbar">
        {TABS.map((t) => (
          <div key={t.id} className={`tool-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon} <span>{t.label}</span>
          </div>
        ))}
      </div>

      <div className="card filter-toolbar-card">
        <div className="card-body">
          <div className="filter-toolbar">
            <div className="filter-presets">
              <button className="preset-chip" onClick={applyToday}>اليوم</button>
              <button className="preset-chip" onClick={apply7d}>آخر 7 أيام</button>
              <button className={`preset-chip ${period === "30d" ? "active" : ""}`} onClick={() => applyPeriod("30d")}>آخر 30 يوم</button>
              <button className="preset-chip" onClick={applyThisMonth}>هذا الشهر</button>
              <button className={`preset-chip ${period === "1y" ? "active" : ""}`} onClick={() => applyPeriod("1y")}>آخر سنة</button>
              <button className={`preset-chip ${period === "all" ? "active" : ""}`} onClick={() => applyPeriod("all")}>كل الوقت</button>
              <button className={`preset-chip ${period === "custom" ? "active" : ""}`} onClick={() => setPeriod("custom")}>فترة مخصصة</button>
            </div>
            <div className="filter-range">
              <div className="range-field">
                <Calendar size={14} strokeWidth={2} />
                <label>من</label>
                <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod("custom"); }} />
              </div>
              <div className="range-field">
                <Calendar size={14} strokeWidth={2} />
                <label>إلى</label>
                <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPeriod("custom"); }} />
              </div>
              <button className="action-btn" title="تحديث" onClick={() => { setFrom((f) => f); setTo((t) => t); }}>
                <RefreshCw size={14} strokeWidth={2.2} /> تحديث
              </button>
            </div>
          </div>
        </div>
      </div>

      {tab === "agents" && <AgentsReport inRange={inRange} data={data} />}
      {tab === "companies" && <CompaniesReport inRange={inRange} data={data} />}
      {tab === "merchants" && <MerchantsReport inRange={inRange} data={data} />}
      {tab === "expenses" && <ExpensesReport inRange={inRange} data={data} />}
      {tab === "treasuries" && <TreasuriesReport inRange={inRange} />}
      {tab === "currency_suppliers" && <CurrencySuppliersReport inRange={inRange} />}
      <style>{chartsCss}</style>
    </div>
  );
}

type RangeFn = (d: string | null | undefined) => boolean;
type SectionProps = { inRange: RangeFn; data: ReportsData };

function ExportBar({ onExcel, onPdf }: { onExcel: () => void; onPdf: () => void }) {
  return (
    <div className="export-bar">
      <button className="export-btn export-btn--excel" onClick={onExcel}>
        <FileSpreadsheet size={15} strokeWidth={2.2} /> تصدير Excel
      </button>
      <button className="export-btn" onClick={onPdf}>
        <FileText size={15} strokeWidth={2.2} /> تصدير PDF
      </button>
    </div>
  );
}

// ---------- helpers ----------
function groupByMonth<T>(items: T[], dateKey: (t: T) => string | null | undefined, valueKey: (t: T) => number) {
  const map = new Map<string, number>();
  for (const it of items) {
    const d = dateKey(it);
    if (!d) continue;
    const k = d.slice(0, 7);
    map.set(k, (map.get(k) || 0) + Number(valueKey(it) || 0));
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value }));
}

function groupBy<T>(items: T[], keyFn: (t: T) => string, valFn: (t: T) => number = () => 1) {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = keyFn(it) || "—";
    map.set(k, (map.get(k) || 0) + Number(valFn(it) || 0));
  }
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

// ---------- Service-type chart (shared by Agents + Companies) ----------
// Ranking / count metric = DISTINCT executed executions per normalized
// service_type (see src/lib/serviceDistribution.ts). The optional
// `valueByService` map only feeds the financial column (agent price × count
// or company price × count) and never influences the ranking.
type SvcExecution = { id: string; operation_status?: string | null; services?: any };
function ServiceTypeChartView({
  executions,
  valueByService,
  totalLabel,
  valueLabel,
}: {
  executions: SvcExecution[];
  valueByService?: Map<string, number>;
  totalLabel: string;
  valueLabel: string;
}) {
  const { agg, totalExecuted } = useMemo(() => {
    const { items, totalExecuted } = computeServiceExecutionDistribution(executions as any);
    const list = items.map((x) => ({
      name: x.label,
      count: x.executionCount,
      total: Number(valueByService?.get(x.label) || 0),
      pct: x.percentageOfExecutions,
    }));
    return { agg: list, totalExecuted };
  }, [executions, valueByService]);

  const totalAll = agg.reduce((s, x) => s + x.total, 0);
  const top = agg[0];

  const [selected, setSelected] = useState<string | null>(null);
  const sel = agg.find((x) => x.name === selected) || null;

  const pieData = agg.map((x) => ({ name: x.name, value: x.count }));
  const barData = agg.map((x) => ({
    name: x.name,
    "عدد التنفيذات": x.count,
    "إجمالي المبيعات": x.total,
  }));

  return (
    <div>
      <KpiRow items={[
        { label: "إجمالي التنفيذات المنفذة", value: fmtNum(totalExecuted) },
        { label: "أكثر خدمة تنفيذًا", value: top ? top.name : "—", tone: "gold" },
        { label: "نسبة أكثر خدمة", value: top ? `${top.pct.toFixed(1)}%` : "—", tone: "green" },
        { label: totalLabel, value: fmtDL(totalAll), tone: "green" },
      ]} />

      {sel && (
        <div className="card" style={{ marginBottom: 14, background: "linear-gradient(180deg,#F8FAFC,#F1F5F9)", border: "1px solid #E2E8F0" }}>
          <div className="card-body" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>الخدمة: {sel.name}</div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13, color: "#334155" }}>
              <div><b>عدد التنفيذات:</b> {fmtNum(sel.count)}</div>
              <div><b>{valueLabel}:</b> {fmtDL(sel.total)}</div>
              <div><b>النسبة:</b> {sel.pct.toFixed(1)}%</div>
            </div>
            <button className="export-btn" onClick={() => setSelected(null)}>إلغاء التحديد</button>
          </div>
        </div>
      )}

      <ChartsGrid>
        <ChartCard title="توزيع الخدمات حسب النوع" subtitle="النسبة المئوية من إجمالي التنفيذات المنفذة" isEmpty={pieData.length === 0}>
          <PieChart>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, n: string) => {
                const pct = totalExecuted > 0 ? ((v / totalExecuted) * 100).toFixed(1) : "0";
                return [`${fmtCount(v)} تنفيذ (${pct}%)`, n];
              }}
            />
            <Legend verticalAlign="bottom" height={30} iconType="circle" />
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="45%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={3}
              stroke="var(--card,#fff)"
              strokeWidth={2}
              onClick={(e: any) => setSelected(e?.name ?? null)}
              label={(e: any) => {
                const pct = totalExecuted > 0 ? ((e.value / totalExecuted) * 100).toFixed(0) : "0";
                return `${pct}%`;
              }}
            >
              {pieData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  style={{ cursor: "pointer", opacity: selected && selected !== entry.name ? 0.45 : 1 }}
                />
              ))}
            </Pie>
          </PieChart>
        </ChartCard>

        <ChartCard title="أكثر الخدمات تنفيذًا" subtitle="اضغط على العمود لعرض التفاصيل" isEmpty={barData.length === 0}>
          <BarChart data={barData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="name" tick={axisTick} interval={0} angle={-15} textAnchor="end" height={70} />
            <YAxis tick={axisTick} tickFormatter={fmtCount} width={70} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(v: number, n: string) => (n === "عدد التنفيذات" ? [fmtCount(v), n] : [fmtTip(v), n])}
            />
            <Legend verticalAlign="top" height={28} iconType="circle" />
            <Bar
              dataKey="عدد التنفيذات"
              radius={[8, 8, 0, 0]}
              maxBarSize={48}
              onClick={(d: any) => setSelected(d?.name ?? null)}
              style={{ cursor: "pointer" }}
            >
              {barData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  style={{ opacity: selected && selected !== entry.name ? 0.45 : 1 }}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
      </ChartsGrid>

      <div className="table-wrap">
        <table className="mobile-cards">
          <thead><tr><th>نوع الخدمة</th><th>عدد التنفيذات</th><th>{valueLabel}</th><th>النسبة %</th></tr></thead>
          <tbody>
            {agg.length === 0 ? (
              <tr><td colSpan={4}><div className="empty"><div className="empty-text">لا توجد بيانات لعرضها</div></div></td></tr>
            ) : agg.map((r) => {
              const active = selected === r.name;
              return (
                <tr key={r.name} onClick={() => setSelected(active ? null : r.name)} style={{ cursor: "pointer", background: active ? "#F1F5F9" : undefined }}>
                  <td className="bold" data-label="الخدمة">{r.name}</td>
                  <td data-label="عدد التنفيذات">{fmtNum(r.count)}</td>
                  <td data-label="القيمة">{fmtDL(r.total)}</td>
                  <td data-label="النسبة">{r.pct.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ padding: "8px 12px", fontSize: 12, color: "#64748B" }}>
          يتم احتساب كل نوع خدمة مرة واحدة فقط داخل التنفيذ الواحد. النسبة من إجمالي التنفيذات المنفذة؛ قد يتجاوز مجموع النسب 100% لأن التنفيذ الواحد قد يحتوي أكثر من نوع خدمة.
        </div>
      </div>
    </div>
  );
}

function SubTabsBar({ tabs, current, onChange }: { tabs: { id: string; label: string; icon?: React.ReactNode }[]; current: string; onChange: (id: string) => void }) {
  return (
    <div className="action-toolbar" style={{ marginBottom: 14 }}>
      {tabs.map((t) => (
        <div key={t.id} className={`tool-tab ${current === t.id ? "active" : ""}`} onClick={() => onChange(t.id)}>
          {t.icon} <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- AGENTS ----------
// Same source of truth as `src/routes/accounts.tsx` KPI cards (لضمان تطابق
// إجمالي التقرير عند "كل الوقت" مع كروت صفحة حسابات الوكلاء عملة بعملة).
function AgentsReport({ inRange, data: rd }: SectionProps) {
  const { agents, transactions: txns, executions, approvals, loading } = rd;

  // Predicate على travel_date/date/created_at (نفس منطق dashboardCollections).
  const predicate = inRange;

  const rpt = useMemo(
    () => computeAgentReport({ agents, transactions: txns, executions, approvals, predicate }),
    [agents, txns, executions, approvals, predicate],
  );
  const data = rpt.rows;
  const fTxns = rpt.filteredTxns;
  const fExecs = rpt.filteredExecutions;
  const fApp = rpt.filteredApprovals;

  // Aggregate KPI cards من نفس Hook صفحة القسم — لكن الأرقام هنا مفلترة بالفترة.
  const agentAllTime = useAgentAccountTotals();

  // Dev-only reconciliation: يقارن كروت الوكلاء "مدى الحياة" بين
  // صفحة الحسابات والتقرير ويطبع أي فرق لكل عملة.
  useEffect(() => {
    const allTime = computeAgentReport({ agents, transactions: txns, executions, approvals });
    logReconciliation(
      "agents",
      {
        services: agentAllTime.services,
        payments: agentAllTime.payments,
        due: agentAllTime.due,
      },
      {
        services: allTime.totals.services,
        payments: allTime.totals.payments,
        due: allTime.totals.due,
      },
    );
  }, [agents, txns, executions, approvals, agentAllTime]);

  const monthlyCollections = groupByMonth(fTxns, (t) => t.date, (t) => txnCollectedAmount(t));
  const flightsByDestination = groupBy(fExecs as any[], (f: any) => f.destination || "غير محدد");
  const approvalsByStatus = groupBy(fApp as any[], (a: any) => a.status || "—");
  const APPROVAL_STATUS_COLORS: Record<string, string> = {
    "سريعة": "#16A34A",
    "بطيئة": "#F59E0B",
    "رفض أمني": "#DC2626",
    "مرفوض": "#DC2626",
    "قيد المراجعة": "#3B82F6",
    "معلق": "#6B7280",
  };
  const totalApprovals = approvalsByStatus.reduce((s, x) => s + (x.value || 0), 0);
  // ترتيب "أعلى الوكلاء تحصيلاً": نستخدم إجمالي المدفوعات بأي عملة (مجموع القيم كمؤشر ترتيب فقط).
  const paidRank = (m: CurrencyMap) => m.entries().reduce((s, e) => s + Math.abs(e.amount), 0);
  const topAgents = [...data].sort((a, b) => paidRank(b.payments) - paidRank(a.payments)).slice(0, 5).map((d) => ({ name: d.name, value: paidRank(d.payments) }));

  const cols = [
    { header: "اسم الوكيل", key: "name" },
    { header: "إجمالي قيمة الخدمات", key: "services" },
    { header: "إجمالي المدفوعات", key: "payments" },
    { header: "صافي المستحق", key: "due" },
    { header: "عدد التنفيذات", key: "executions" },
    { header: "عدد التقديمات", key: "approvals" },
  ];
  const rows = data.map((r) => ({
    name: r.name,
    services: formatCurrencyMap(r.services),
    payments: formatCurrencyMap(r.payments),
    due: formatCurrencyMap(r.due),
    executions: fmtNum(r.executions), executions__excel: r.executions,
    approvals: fmtNum(r.approvals), approvals__excel: r.approvals,
  }));

  // Financial column (sales value per service type) — kept scalar for chart use only.
  const agentValueByService = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of fTxns) {
      if (!t.agent_id) continue;
      if ((t as any).source_service_type === "payment") continue;
      if (t.service_type === "دفعة من الوكيل") continue;
      const v = tripValue(t);
      if (!(v > 0)) continue;
      const label = normalizeServiceType(t.service_type);
      if (!label) continue;
      map.set(label, (map.get(label) || 0) + v);
    }
    return map;
  }, [fTxns]);
  const agentExecutions = fExecs as any[];
  const [view, setView] = useState<"summary" | "chart">("summary");

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">👥 تقرير الوكلاء</div></div>
      <div className="card-body">
        <SubTabsBar
          tabs={[
            { id: "summary", label: "الملخص", icon: <BarChart3 size={15} strokeWidth={2} /> },
            { id: "chart", label: "تحليل خدمات الوكلاء", icon: <Activity size={15} strokeWidth={2} /> },
          ]}
          current={view}
          onChange={(v) => setView(v as "summary" | "chart")}
        />
        {view === "chart" ? (
          <ServiceTypeChartView executions={agentExecutions} valueByService={agentValueByService} totalLabel="إجمالي قيمة الخدمات" valueLabel="إجمالي المبيعات" />
        ) : (<>

        <KpiRow items={[
          { label: "إجمالي المدفوعات", value: <CurrencyLines map={rpt.totals.payments} />, tone: "green" },
          { label: "إجمالي قيمة الخدمات", value: <CurrencyLines map={rpt.totals.services} />, tone: "gold" },
          { label: "صافي المستحق", value: <CurrencyLines map={rpt.totals.due} />, tone: "red" },
          { label: "عدد التنفيذات", value: fmtNum(rpt.totals.executionsCount) },
          { label: "عدد التقديمات", value: fmtNum(rpt.totals.approvalsCount) },
        ]} />

        <ChartsGrid>
          <ChartCard title="إجمالي التحصيلات خلال الفترة" subtitle="مجموع التحصيلات الشهرية" isEmpty={monthlyCollections.length === 0}>
            <AreaChart data={monthlyCollections} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="agCollGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.income} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLORS.income} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickMargin={8} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "التحصيلات"]} />
              <Area type="monotone" dataKey="value" stroke={COLORS.income} strokeWidth={2.5} fill="url(#agCollGrad)" name="التحصيلات" />
            </AreaChart>
          </ChartCard>

          <ChartCard title="التنفيذات حسب الوجهة" subtitle="عدد التنفيذات لكل وجهة" isEmpty={flightsByDestination.length === 0}>
            <BarChart data={flightsByDestination} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={axisTick} allowDecimals={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtCount(v), "عدد التنفيذات"]} />
              <Bar dataKey="value" name="عدد التنفيذات" fill={COLORS.positive} radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartCard>

          <ChartCard title="التقديمات حسب الحالة" subtitle="توزيع التقديمات على الحالات" isEmpty={approvalsByStatus.length === 0}>
            <PieChart>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, n: string) => {
                  const pct = totalApprovals > 0 ? ((v / totalApprovals) * 100).toFixed(1) : "0";
                  return [`${fmtCount(v)} (${pct}%)`, n];
                }}
              />
              <Legend verticalAlign="bottom" height={30} iconType="circle" />
              <Pie data={approvalsByStatus} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={60} outerRadius={95} paddingAngle={3} stroke="var(--card,#fff)" strokeWidth={2} label={(e: any) => `${e.value}`}>
                {approvalsByStatus.map((entry, i) => (
                  <Cell key={i} fill={APPROVAL_STATUS_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartCard>

          <ChartCard title="أعلى الوكلاء تحصيلاً" subtitle="أكثر 5 وكلاء من حيث التحصيل" isEmpty={topAgents.length === 0}>
            <BarChart data={topAgents} layout="vertical" margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis type="number" tick={axisTick} tickFormatter={fmtCount} />
              <YAxis type="category" dataKey="name" tick={axisTick} width={100} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "التحصيلات"]} />
              <Bar dataKey="value" name="التحصيلات" fill={COLORS.warning} radius={[0, 8, 8, 0]} maxBarSize={28} />
            </BarChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الوكلاء", columns: cols, rows, fileName: "تقرير الوكلاء" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الوكلاء", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا يوجد وكلاء" colSpan={cols.length} />
              ) : data.map((r) => (
                <tr key={r.id}>
                  <td className="bold" data-label="الوكيل">{r.name}</td>
                  <td data-label="القيمة"><CurrencyLines map={r.services} /></td>
                  <td data-label="المدفوعات"><CurrencyLines map={r.payments} /></td>
                  <td data-label="المستحق"><CurrencyLines map={r.due} /></td>
                  <td data-label="تنفيذات">{fmtNum(r.executions)}</td>
                  <td data-label="موافقات">{fmtNum(r.approvals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>)}
      </div>
    </div>
  );
}


// ---------- COMPANIES ----------
function CompaniesReport({ inRange, data: rd }: SectionProps) {
  const { companies, companyTransactions: cTxns, paymentSplits, approvals, loading } = rd;

  // Currency-Safe: نفس مصدر صفحة الشركات (summarizeCompany + buildCompanyLedgerRows).
  const predicate = inRange;
  const rpt = useMemo(
    () => computeCompanyReport({
      companies,
      companyTransactions: cTxns,
      paymentSplits,
      approvals,
      predicate,
    }),
    [companies, cTxns, paymentSplits, approvals, predicate],
  );
  const data = rpt.rows;
  const fCT = rpt.filteredTxns;

  // Reconciliation: كروت "مدى الحياة" في التقرير يجب أن تطابق كروت
  // صفحة حسابات الشركات بالضبط لكل عملة.
  const companiesAllTime = useCompaniesSummary();
  useEffect(() => {
    const totalDebit = new CurrencyMap();
    const totalCredit = new CurrencyMap();
    const totalBalance = new CurrencyMap();
    for (const [, sum] of companiesAllTime) {
      totalDebit.merge(sum.totalDebit);
      totalCredit.merge(sum.totalCredit);
      totalBalance.merge(sum.balance);
    }
    const allTime = computeCompanyReport({
      companies, companyTransactions: cTxns, paymentSplits, approvals,
    });
    logReconciliation(
      "companies",
      { services: totalDebit, paid: totalCredit, due: totalBalance },
      { services: allTime.totals.services, paid: allTime.totals.paid, due: allTime.totals.due },
    );
  }, [companies, cTxns, paymentSplits, approvals, companiesAllTime]);

  const monthlyPayments = groupByMonth(fCT, (t) => t.date, (t) => txnCollectedAmount(t));
  // ترتيب "أعلى الشركات": بعدد الحركات المميزة ضمن الفترة.
  const topCompanies = [...data].sort((a, b) => b.txnCount - a.txnCount).slice(0, 5)
    .map((d) => ({ name: d.name, value: d.txnCount }));
  // مؤشر Pie: إجمالي المدفوعات (بأي عملة كمؤشر ترتيبي فقط، لا يتم جمع العملات).
  const paidRank = (m: CurrencyMap) => m.entries().reduce((s, e) => s + Math.abs(e.amount), 0);
  const servicesByCompany = data.filter((d) => paidRank(d.paid) > 0)
    .sort((a, b) => paidRank(b.paid) - paidRank(a.paid))
    .slice(0, 6)
    .map((d) => ({ name: d.name, value: paidRank(d.paid) }));

  const cols = [
    { header: "اسم الشركة", key: "name" },
    { header: "إجمالي الخدمات", key: "services" },
    { header: "إجمالي المدفوع", key: "paid" },
    { header: "صافي المستحق", key: "due" },
    { header: "عدد الحركات", key: "txnCount" },
    { header: "عدد التقديمات", key: "approvalCount" },
  ];
  const rows = data.map((r) => ({
    name: r.name,
    services: formatCurrencyMap(r.services),
    paid: formatCurrencyMap(r.paid),
    due: formatCurrencyMap(r.due),
    txnCount: fmtNum(r.txnCount), txnCount__excel: r.txnCount,
    approvalCount: fmtNum(r.approvalCount), approvalCount__excel: r.approvalCount,
  }));

  // Financial column per service (company cost) — for the chart view only.
  const companyValueByService = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of fCT) {
      if (!t.company_id) continue;
      if ((t as any).source_service_type === "payment") continue;
      const v = Number(t.trip_value || 0) || Number(t.count || 0) * Number(t.price || 0);
      if (!(v > 0)) continue;
      const label = normalizeServiceType(t.service_type);
      if (!label) continue;
      map.set(label, (map.get(label) || 0) + v);
    }
    return map;
  }, [fCT]);
  const companyExecutions = useMemo(() => {
    const list: any[] = [];
    for (const ex of rd.executions) {
      if ((ex.operation_status || "") !== "منفذ") continue;
      const d = (ex.travel_date && String(ex.travel_date)) ||
        (ex.created_at ? String(ex.created_at).slice(0, 10) : null);
      if (!inRange(d)) continue;
      const svc = Array.isArray(ex.services) ? ex.services : [];
      const hasCompanyService = svc.some((s: any) => s && s.kind === "company" && s.company_id);
      if (!hasCompanyService) continue;
      list.push({
        ...ex,
        services: svc.filter((s: any) => s && s.kind === "company"),
      });
    }
    return list;
  }, [rd.executions, inRange]);
  const [view, setView] = useState<"summary" | "chart">("summary");

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🏢 تقرير الشركات الصادرة</div></div>
      <div className="card-body">
        <SubTabsBar
          tabs={[
            { id: "summary", label: "الملخص", icon: <BarChart3 size={15} strokeWidth={2} /> },
            { id: "chart", label: "تحليل خدمات الشركات", icon: <Activity size={15} strokeWidth={2} /> },
          ]}
          current={view}
          onChange={(v) => setView(v as "summary" | "chart")}
        />
        {view === "chart" ? (
          <ServiceTypeChartView executions={companyExecutions} valueByService={companyValueByService} totalLabel="إجمالي تكلفة الخدمات" valueLabel="إجمالي التكلفة" />
        ) : (<>

        <KpiRow items={[
          { label: "إجمالي المدفوعات", value: <CurrencyLines map={rpt.totals.paid} />, tone: "red" },
          { label: "إجمالي قيمة الخدمات", value: <CurrencyLines map={rpt.totals.services} />, tone: "gold" },
          { label: "صافي المستحق", value: <CurrencyLines map={rpt.totals.due} />, tone: "green" },
          { label: "عدد الشركات", value: fmtNum(companies.length) },
          { label: "عدد الحركات", value: fmtNum(rpt.totals.txnCount) },
        ]} />

        <ChartsGrid>
          <ChartCard title="إجمالي المدفوعات للشركات" subtitle="مجموع مدفوعات الشركات الشهرية" isEmpty={monthlyPayments.length === 0}>
            <AreaChart data={monthlyPayments} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="coPayGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.negative} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.negative} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickMargin={8} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "المدفوعات"]} />
              <Area type="monotone" dataKey="value" stroke={COLORS.negative} strokeWidth={2.5} fill="url(#coPayGrad)" name="المدفوعات" />
            </AreaChart>
          </ChartCard>

          <ChartCard title="أعلى الشركات استخداماً" subtitle="أكثر 5 شركات من حيث عدد الحركات" isEmpty={topCompanies.length === 0}>
            <BarChart data={topCompanies} layout="vertical" margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis type="number" tick={axisTick} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={axisTick} width={110} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtCount(v), "عدد الحركات"]} />
              <Bar dataKey="value" name="عدد الحركات" fill={COLORS.income} radius={[0, 8, 8, 0]} maxBarSize={28} />
            </BarChart>
          </ChartCard>

          <ChartCard title="الخدمات حسب الشركة الصادرة" subtitle="توزيع المدفوعات على الشركات" isEmpty={servicesByCompany.length === 0}>
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtTip(v), n]} />
              <Legend verticalAlign="bottom" height={30} iconType="circle" />
              <Pie data={servicesByCompany} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={60} outerRadius={95} paddingAngle={3} stroke="var(--card,#fff)" strokeWidth={2}>
                {servicesByCompany.map((_e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
            </PieChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الشركات الصادرة", columns: cols, rows, fileName: "تقرير الشركات الصادرة" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الشركات الصادرة", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد شركات" colSpan={cols.length} />
              ) : data.map((r) => (
                <tr key={r.id}>
                  <td className="bold" data-label="الشركة">{r.name}</td>
                  <td data-label="الخدمات"><CurrencyLines map={r.services} /></td>
                  <td data-label="المدفوع"><CurrencyLines map={r.paid} /></td>
                  <td data-label="المستحق"><CurrencyLines map={r.due} /></td>
                  <td data-label="الحركات">{fmtNum(r.txnCount)}</td>
                  <td data-label="التقديمات">{fmtNum(r.approvalCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>)}
      </div>
    </div>
  );
}


// ---------- MERCHANTS ----------
function MerchantsReport({ inRange, data: rd }: SectionProps) {
  const { merchants, transactions: txns, companyTransactions: cTxns, merchantCollections: collections, usdTreasury, paymentSplits, loading } = rd;

  const rpt = useMemo(
    () => summarizeMerchantReport({ merchants, transactions: txns, companyTransactions: cTxns, collections, usdRows: usdTreasury, splits: paymentSplits, inRange }),
    [merchants, txns, cTxns, collections, usdTreasury, paymentSplits, inRange],
  );
  const data = rpt.rows;

  // ⚠️ الرسوم البيانية تقبل رقماً واحداً لكل شريحة — لذا نعرض EGP فقط
  // (وليس دمج EGP+USD+LYD في قيمة واحدة). العملات الأخرى تُعرض في الجدول
  // والكروت أدناه كل على حدة.
  const flow = data.map((d) => ({ name: d.name, "وارد": d.incoming.get("EGP"), "صادر": d.outgoing.get("EGP") }));
  const fees = data.filter((d) => d.fee.get("EGP") > 0).map((d) => ({ name: d.name, value: d.fee.get("EGP") }));
  const balances = data.map((d) => ({ name: d.name, value: d.balance.get("EGP") }));

  const totIn = rpt.totalIn;
  const totOut = rpt.totalOut;
  const totFee = rpt.totalFee;

  const cols = [
    { header: "اسم التاجر", key: "name" },
    { header: "وارد تاجر الكاش من الوكلاء", key: "incoming" },
    { header: "صادر تاجر الكاش للشركات", key: "outgoing" },
    { header: "النقدية المحصلة", key: "collected" },
    { header: "نسبة 1%", key: "fee" },
    { header: "الرصيد", key: "balance" },
  ];
  const rows = data.map((r) => ({
    name: r.name,
    incoming: formatCurrencyMap(r.incoming), incoming__excel: r.incoming.get("EGP"),
    outgoing: formatCurrencyMap(r.outgoing), outgoing__excel: r.outgoing.get("EGP"),
    collected: formatCurrencyMap(r.collected), collected__excel: r.collected.get("EGP"),
    fee: formatCurrencyMap(r.fee), fee__excel: r.fee.get("EGP"),
    balance: formatCurrencyMap(r.balance), balance__excel: r.balance.get("EGP"),
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🤝 تقرير تاجر الكاش</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "إجمالي الوارد", value: <CurrencyLines map={totIn} />, tone: "green" },
          { label: "إجمالي الصادر", value: <CurrencyLines map={totOut} />, tone: "red" },
          { label: "عمولات 1%", value: <CurrencyLines map={totFee} />, tone: "gold" },
          { label: "عدد التجار", value: fmtNum(merchants.length) },
        ]} />

        <ChartsGrid>
          <ChartCard title="حركة تاجر الكاش (EGP)" subtitle="مقارنة بين الوارد والصادر لكل تاجر — بالجنيه فقط" isEmpty={flow.length === 0}>
            <BarChart data={flow} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number, n: string) => [fmtTip(v), n]} />
              <Legend verticalAlign="top" height={28} iconType="circle" />
              <Bar dataKey="وارد" fill={COLORS.positive} radius={[8, 8, 0, 0]} maxBarSize={36} />
              <Bar dataKey="صادر" fill={COLORS.negative} radius={[8, 8, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ChartCard>

          <ChartCard title="عمولات التجار 1% (EGP)" subtitle="إجمالي العمولات لكل تاجر — بالجنيه فقط" isEmpty={fees.length === 0}>
            <BarChart data={fees} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "العمولة"]} />
              <Bar dataKey="value" name="العمولة" fill={COLORS.warning} radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartCard>

          <ChartCard title="أرصدة التجار (EGP)" subtitle="الرصيد الحالي لكل تاجر — بالجنيه فقط" isEmpty={balances.length === 0}>
            <BarChart data={balances} layout="vertical" margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis type="number" tick={axisTick} tickFormatter={fmtCount} />
              <YAxis type="category" dataKey="name" tick={axisTick} width={110} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "الرصيد"]} />
              <Bar dataKey="value" name="الرصيد" fill={COLORS.income} radius={[0, 8, 8, 0]} maxBarSize={28} />
            </BarChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير تاجر الكاش", columns: cols, rows, fileName: "تقرير تاجر الكاش" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير تاجر الكاش", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا يوجد تجار" colSpan={cols.length} />
              ) : data.map((r, i) => (
                <tr key={i}>
                  <td className="bold" data-label="التاجر">{r.name}</td>
                  <td data-label="وارد"><CurrencyLines map={r.incoming} /></td>
                  <td data-label="صادر"><CurrencyLines map={r.outgoing} /></td>
                  <td data-label="محصل"><CurrencyLines map={r.collected} /></td>
                  <td data-label="نسبة"><CurrencyLines map={r.fee} /></td>
                  <td data-label="الرصيد" style={{ fontWeight: 700 }}><CurrencyLines map={r.balance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ---------- INVESTORS ----------
function InvestorsReport({ inRange, data: rd }: SectionProps) {
  const { investors, investorTransactions: invTxns, loading } = rd;

  const rpt = useMemo(
    () => summarizeInvestorReport({ investors, investorTransactions: invTxns, inRange }),
    [investors, invTxns, inRange],
  );
  const data = rpt.rows;
  const fIT = rpt.filteredTxns;

  // Chart-only shaping (monthly + running series).
  const monthlyMap = new Map<string, { month: string; deposit: number; withdraw: number }>();
  for (const t of fIT) {
    const k = (t.date || "").slice(0, 7);
    if (!k) continue;
    const cur = monthlyMap.get(k) || { month: k, deposit: 0, withdraw: 0 };
    if (t.transaction_type === "توريد نقدية") cur.deposit += Number(t.amount || 0);
    else if (t.transaction_type === "صرف نقدية") cur.withdraw += Number(t.amount || 0);
    monthlyMap.set(k, cur);
  }
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  let running = 0;
  const balanceSeries = monthly.map((m) => {
    running += m.deposit - m.withdraw;
    return { month: m.month, value: running };
  });

  const totDep = rpt.totalDeposit;
  const totWd = rpt.totalWithdraw;
  const totBal = rpt.totalBalance;

  const cols = [
    { header: "اسم المستثمر", key: "name" },
    { header: "إجمالي التوريد", key: "deposit" },
    { header: "إجمالي الصرف", key: "withdraw" },
    { header: "الرصيد", key: "balance" },
  ];
  const rows = data.map((r) => ({
    ...r,
    deposit: fmtDL(r.deposit), deposit__excel: r.deposit,
    withdraw: fmtDL(r.withdraw), withdraw__excel: r.withdraw,
    balance: fmtDL(r.balance), balance__excel: r.balance,
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🧑‍💼 تقرير المستثمرين</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "إجمالي التوريدات", value: fmtDL(totDep), tone: "green" },
          { label: "إجمالي المسحوبات", value: fmtDL(totWd), tone: "red" },
          { label: "صافي الرصيد", value: fmtDL(totBal), tone: "gold" },
          { label: "عدد المستثمرين", value: fmtNum(investors.length) },
        ]} />

        <ChartsGrid>
          <ChartCard title="حركة المستثمرين" subtitle="التوريدات مقابل المسحوبات شهرياً" isEmpty={monthly.length === 0}>
            <BarChart data={monthly} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickMargin={8} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number, n: string) => [fmtTip(v), n === "deposit" ? "توريد" : n === "withdraw" ? "صرف" : n]} />
              <Legend verticalAlign="top" height={28} iconType="circle" />
              <Bar dataKey="deposit" name="توريد" fill={COLORS.positive} radius={[8, 8, 0, 0]} maxBarSize={32} />
              <Bar dataKey="withdraw" name="صرف" fill={COLORS.negative} radius={[8, 8, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ChartCard>

          <ChartCard title="تطور رصيد المستثمرين" subtitle="صافي الرصيد التراكمي للمستثمرين" isEmpty={balanceSeries.length === 0}>
            <LineChart data={balanceSeries} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickMargin={8} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "الرصيد"]} />
              <Line type="monotone" dataKey="value" name="الرصيد" stroke={COLORS.investor} strokeWidth={2.5} dot={{ r: 3, fill: COLORS.investor }} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير المستثمرين", columns: cols, rows, fileName: "تقرير المستثمرين" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير المستثمرين", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا يوجد مستثمرين" colSpan={cols.length} />
              ) : data.map((r, i) => (
                <tr key={i}>
                  <td className="bold" data-label="المستثمر">{r.name}</td>
                  <td data-label="توريد">{fmtDL(r.deposit)}</td>
                  <td data-label="صرف">{fmtDL(r.withdraw)}</td>
                  <td data-label="الرصيد" style={{ fontWeight: 700 }}>{fmtDL(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- FLIGHTS ----------
function FlightsReport({ inRange, data: rd }: SectionProps) {
  const { flights, agentName, loading } = rd;
  // Date filter: include the flight if EITHER travel_date OR created_at falls in range.
  // travel_date is often in the future (booking) and would otherwise be excluded by "آخر 30 يوم".
  // If both are missing, keep the record visible.
  const flightInRange = (f: typeof flights[number]) => {
    const td = f.travel_date ? String(f.travel_date) : null;
    const cd = f.created_at ? String(f.created_at).slice(0, 10) : null;
    if (!td && !cd) return true;
    return (td && inRange(td)) || (cd && inRange(cd));
  };
  const filtered = flights.filter(flightInRange);

  if (typeof window !== "undefined") {
    console.log("[FlightsReport] fetched:", flights.length, "filtered:", filtered.length, "loading:", loading);
  }

  const cols = [
    { header: "المسافر", key: "passenger" },
    { header: "الوكيل", key: "agent" },
    { header: "الشركة الصادرة", key: "company" },
    { header: "شركة الطيران", key: "airline" },
    { header: "الوجهة", key: "destination" },
    { header: "تاريخ السفر", key: "date" },
    { header: "الحالة", key: "status" },
    { header: "بيان السفر", key: "statement" },
  ];
  const rows = filtered.map((f) => ({
    passenger: f.passenger_name,
    agent: agentName(f.agent_id),
    company: f.issuing_company || "—",
    airline: f.airline || "—",
    destination: f.destination || "—",
    date: f.travel_date || "—",
    status: f.status,
    statement: f.travel_statement || "—",
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">✈️ تقرير التنفيذات</div></div>
      <div className="card-body">
        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير التنفيذات", columns: cols, rows, fileName: "تقرير التنفيذات" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير التنفيذات", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد تنفيذات" colSpan={cols.length} />
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td className="bold" data-label="المسافر">{r.passenger}</td>
                  <td data-label="الوكيل">{r.agent}</td>
                  <td data-label="الشركة">{r.company}</td>
                  <td data-label="الطيران">{r.airline}</td>
                  <td data-label="الوجهة">{r.destination}</td>
                  <td data-label="التاريخ">{r.date}</td>
                  <td data-label="الحالة">{r.status}</td>
                  <td data-label="البيان">{r.statement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- APPROVALS ----------
function ApprovalsReport({ inRange, data: rd }: SectionProps) {
  const { approvals, agentName, companyName, loading } = rd;
  // Date filter: use submit_date when present, otherwise fall back to created_at.
  const approvalDate = (a: typeof approvals[number]) =>
    (a.submit_date && String(a.submit_date)) || (a.created_at ? String(a.created_at).slice(0, 10) : null);
  const filtered = approvals.filter((a) => inRange(approvalDate(a)));

  if (typeof window !== "undefined") {
    console.log("[ApprovalsReport] fetched:", approvals.length, "filtered:", filtered.length, "loading:", loading);
  }

  const cols = [
    { header: "المسافر", key: "passenger" },
    { header: "الوكيل", key: "agent" },
    { header: "شركة الإصدار", key: "company" },
    { header: "الوجهة", key: "destination" },
    { header: "الجهة", key: "authority" },
    { header: "تاريخ التقديم", key: "submit" },
    { header: "تاريخ الصدور", key: "issue" },
    { header: "سعر الوكيل", key: "amount" },
    { header: "الحالة", key: "status" },
  ];
  const rows = filtered.map((a) => ({
    passenger: a.passenger_name,
    agent: agentName(a.agent_id),
    company: companyName(a.approval_company_id),
    destination: "—",
    authority: a.approval_authority || "—",
    submit: a.submit_date || "—",
    issue: a.issue_date || "—",
    amount: fmtDL(Number((a as any).agent_price || 0)),
    status: a.status,
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📋 تقرير التقديمات</div></div>
      <div className="card-body">
        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير التقديمات", columns: cols, rows, fileName: "تقرير التقديمات" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير التقديمات", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد موافقات" colSpan={cols.length} />
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td className="bold" data-label="المسافر">{r.passenger}</td>
                  <td data-label="الوكيل">{r.agent}</td>
                  <td data-label="الشركة">{r.company}</td>
                  <td data-label="الوجهة">{r.destination}</td>
                  <td data-label="الجهة">{r.authority}</td>
                  <td data-label="التقديم">{r.submit}</td>
                  <td data-label="الصدور">{r.issue}</td>
                  <td data-label="القيمة">{r.amount}</td>
                  <td data-label="الحالة">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- EXPENSES ----------
function ExpensesReport({ inRange, data: rd }: SectionProps) {
  const { expenses, loading } = rd;
  const data = useMemo(() => expenses.filter((e) => inRange(e.date)), [expenses, inRange]);
  const { total: totalAll, fixed: totalFixed, variable: totalVar } = useMemo(
    () => summarizeExpenses(data),
    [data],
  );

  const typeSplit = [
    { name: "ثابت", value: totalFixed },
    { name: "متغير", value: totalVar },
  ].filter((x) => x.value > 0);

  const monthly = groupByMonth(data, (e) => e.date, (e) => Number(e.amount || 0));

  const itemMap = new Map<string, number>();
  for (const e of data) itemMap.set(e.expense_name, (itemMap.get(e.expense_name) || 0) + Number(e.amount || 0));
  const topItems = Array.from(itemMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);

  const cols = [
    { header: "اسم المصروف", key: "name" },
    { header: "النوع", key: "type" },
    { header: "المبلغ", key: "amount" },
    { header: "التاريخ", key: "date" },
    { header: "طريقة الدفع", key: "method" },
    { header: "البيان", key: "statement" },
    { header: "ملاحظات", key: "notes" },
  ];
  const rows = data.map((e) => ({
    name: e.expense_name,
    type: e.expense_type,
    amount: fmtDL(Number(e.amount || 0)),
    date: e.date,
    method: e.payment_method,
    statement: (e as any).statement || "",
    notes: e.notes || "—",
  }));
  const summary = [
    { label: "إجمالي المصروفات", value: fmtDL(totalAll) },
    { label: "المصروفات الثابتة", value: fmtDL(totalFixed) },
    { label: "المصروفات المتغيرة", value: fmtDL(totalVar) },
  ];

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 تقرير المصروفات</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "إجمالي المصروفات", value: fmtDL(totalAll), tone: "red" },
          { label: "المصروفات الثابتة", value: fmtDL(totalFixed), tone: "gold" },
          { label: "المصروفات المتغيرة", value: fmtDL(totalVar) },
          { label: "عدد البنود", value: fmtNum(data.length) },
        ]} />

        <ChartsGrid>
          <ChartCard title="مصروفات حسب النوع" subtitle="توزيع المصروفات الثابتة والمتغيرة" isEmpty={typeSplit.length === 0}>
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtTip(v), n]} />
              <Legend verticalAlign="bottom" height={30} iconType="circle" />
              <Pie data={typeSplit} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={60} outerRadius={95} paddingAngle={3} stroke="var(--card,#fff)" strokeWidth={2}>
                <Cell fill={COLORS.warning} />
                <Cell fill={COLORS.negative} />
              </Pie>
            </PieChart>
          </ChartCard>

          <ChartCard title="المصروفات الشهرية" subtitle="إجمالي المصروفات لكل شهر" isEmpty={monthly.length === 0}>
            <BarChart data={monthly} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickMargin={8} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "المصروفات"]} />
              <Bar dataKey="value" name="المصروفات" fill={COLORS.negative} radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartCard>

          <ChartCard title="أعلى بنود المصروفات" subtitle="أكثر 6 بنود من حيث القيمة" isEmpty={topItems.length === 0}>
            <BarChart data={topItems} layout="vertical" margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis type="number" tick={axisTick} tickFormatter={fmtCount} />
              <YAxis type="category" dataKey="name" tick={axisTick} width={110} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "القيمة"]} />
              <Bar dataKey="value" name="القيمة" fill={COLORS.warning} radius={[0, 8, 8, 0]} maxBarSize={28} />
            </BarChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير المصروفات", columns: cols, rows, summary, fileName: "تقرير المصروفات" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير المصروفات", columns: cols, rows, summary })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد مصروفات" colSpan={cols.length} />
              ) : data.map((e) => (
                <tr key={e.id}>
                  <td className="bold" data-label="اسم المصروف">{e.expense_name}</td>
                  <td data-label="النوع">{e.expense_type}</td>
                  <td data-label="المبلغ">{fmtDL(Number(e.amount || 0))}</td>
                  <td data-label="التاريخ">{e.date}</td>
                  <td data-label="طريقة الدفع">{e.payment_method}</td>
                  <td data-label="البيان">{(e as any).statement || ""}</td>
                  <td data-label="ملاحظات">{e.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- USD TREASURY ----------
const USD_SOURCE_LABELS: Record<string, string> = {
  insta_company: "انستا الشركة",
  cash_company: "نقدي الشركة",
  merchant_wallet: "تاجر الكاش",
  merchant_physical: "نقدي التاجر",
};

function usdMovementLabel(r: UsdTreasuryTransaction): string {
  if (r.type === "conversion") return "تحويل إلى الخزينة الدولارية";
  if (r.type === "company_payment") {
    return Number(r.egp_amount || 0) > 0
      ? "دفع مختلط جنيه/دولار"
      : "دفع لشركة صادرة بالدولار";
  }
  return r.type || "—";
}

function UsdTreasuryReport({ inRange, data: rd }: SectionProps) {
  const { usdTreasury, companyName, merchantName, loading } = rd;

  const rpt = useMemo(
    () => summarizeUsdTreasuryPeriod(usdTreasury, inRange),
    [usdTreasury, inRange],
  );
  void rpt.withBalance;
  const filtered = rpt.filtered;
  const periodConversions = rpt.periodConversions;
  const periodPayments = rpt.periodPayments;
  const periodEgpUsed = rpt.periodEgpUsed;
  const currentBalance = rpt.currentBalance;

  // Monthly chart (period)
  const monthlyMap = new Map<string, { conv: number; pay: number }>();
  for (const x of filtered) {
    const k = (x.row.date || "").slice(0, 7);
    if (!k) continue;
    const cur = monthlyMap.get(k) || { conv: 0, pay: 0 };
    if (x.row.type === "conversion") cur.conv += Number(x.row.usd_amount || 0);
    else if (x.row.type === "company_payment") cur.pay += Number(x.row.usd_amount || 0);
    monthlyMap.set(k, cur);
  }
  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, "تحويلات": v.conv, "مدفوعات": v.pay }));

  // Source breakdown (period, conversions only)
  const sourceMap = new Map<string, number>();
  for (const x of filtered) {
    if (x.row.type !== "conversion") continue;
    const key = USD_SOURCE_LABELS[x.row.source_type || ""] || "—";
    sourceMap.set(key, (sourceMap.get(key) || 0) + Number(x.row.usd_amount || 0));
  }
  const sourcePie = Array.from(sourceMap.entries()).map(([name, value]) => ({ name, value }));

  const cols = [
    { header: "التاريخ", key: "date" },
    { header: "نوع الحركة", key: "movement" },
    { header: "المبلغ بالجنيه", key: "egp" },
    { header: "سعر الصرف", key: "rate" },
    { header: "المبلغ بالدولار", key: "usd" },
    { header: "مصدر التحويل", key: "source" },
    { header: "اسم التاجر", key: "merchant" },
    { header: "الشركة الصادرة", key: "company" },
    { header: "الخدمة / المسافر", key: "service" },
    { header: "بيان الحركة", key: "note" },
    { header: "الرصيد الدولاري بعد الحركة", key: "balance" },
    { header: "إجراءات", key: "actions" },
  ];

  const rows = filtered.map((x) => {
    const r = x.row;
    const isMerchantSrc = r.source_type === "merchant_wallet" || r.source_type === "merchant_physical";
    return {
      date: r.date,
      movement: usdMovementLabel(r),
      egp: fmtDL(Number(r.egp_amount || 0)),
      egp__excel: Number(r.egp_amount || 0),
      rate: formatExchangeRate(r.exchange_rate),
      rate__excel: Number(r.exchange_rate || 0),
      usd: fmtUSD(Number(r.usd_amount || 0)),
      usd__excel: Number(r.usd_amount || 0),
      source: USD_SOURCE_LABELS[r.source_type || ""] || "—",
      merchant: isMerchantSrc ? merchantName(r.merchant_id) : "—",
      company: r.company_id ? companyName(r.company_id) : "—",
      service: r.note || "—",
      note: (r as any).statement || "",
      balance: fmtUSD(x.balance),
      balance__excel: x.balance,
    };
  });

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💵 تقرير الخزينة الدولارية</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "الرصيد الدولاري الحالي", value: fmtUSD(currentBalance), tone: "gold" },
          { label: "إجمالي التحويلات بالدولار", value: fmtUSD(periodConversions), tone: "green" },
          { label: "إجمالي المدفوعات بالدولار", value: fmtUSD(periodPayments), tone: "red" },
          { label: "إجمالي الجنيه المُحوّل", value: fmtDL(periodEgpUsed) },
        ]} />

        <ChartsGrid>
          <ChartCard title="حركة الخزينة الدولارية" subtitle="تحويلات مقابل مدفوعات شهرياً" isEmpty={monthly.length === 0}>
            <BarChart data={monthly} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={axisTick} tickMargin={8} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number, n: string) => [`${fmtCount(v)} $`, n]} />
              <Legend verticalAlign="top" height={28} iconType="circle" />
              <Bar dataKey="تحويلات" fill={COLORS.positive} radius={[8, 8, 0, 0]} maxBarSize={36} />
              <Bar dataKey="مدفوعات" fill={COLORS.negative} radius={[8, 8, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ChartCard>

          <ChartCard title="مصادر التحويل" subtitle="توزيع التحويلات على المصادر" isEmpty={sourcePie.length === 0}>
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtCount(v)} $`, n]} />
              <Legend verticalAlign="bottom" height={30} iconType="circle" />
              <Pie data={sourcePie} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={60} outerRadius={95} paddingAngle={3} stroke="var(--card,#fff)" strokeWidth={2}>
                {sourcePie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
            </PieChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الخزينة الدولارية", columns: cols, rows, fileName: "تقرير الخزينة الدولارية" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الخزينة الدولارية", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد حركات للخزينة الدولارية" colSpan={cols.length} />
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td data-label="التاريخ">{r.date}</td>
                  <td className="bold" data-label="نوع الحركة">{r.movement}</td>
                  <td data-label="بالجنيه">{r.egp}</td>
                  <td data-label="سعر الصرف">{r.rate}</td>
                  <td data-label="بالدولار">{r.usd}</td>
                  <td data-label="المصدر">{r.source}</td>
                  <td data-label="التاجر">{r.merchant}</td>
                  <td data-label="الشركة">{r.company}</td>
                  <td data-label="الخدمة">{r.service}</td>
                  <td data-label="بيان">{r.note}</td>
                  <td data-label="الرصيد">{r.balance}</td>
                  <td data-label="إجراءات">
                    <EditTransactionButton table="usd_treasury_transactions" id={filtered[i]?.row.id || ""} cancelled={false} />
                    <CancelTransactionButton table="usd_treasury_transactions" id={filtered[i]?.row.id || ""} cancelled={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- TREASURIES (cash boxes) ----------
type CashBoxRow = { id: string; name: string; currency: string; balance: number; is_active: boolean; opening_balance?: number; opening_date?: string | null; opening_note?: string | null };
type TreasuryOperationSplit = {
  id: string;
  cash_box_id: string | null;
  amount: number | string | null;
  currency: string | null;
  direction: string | null;
  method: string | null;
  source_table: string | null;
  source_id: string | null;
  created_at: string;
  cancelled_at?: string | null;
};
type TreasuryOperationRow = {
  id: string;
  performedAt: string;
  kind: "transfer" | "settlement_in" | "settlement_out";
  type: string;
  from: string;
  to: string;
  fromBoxId: string | null;
  toBoxId: string | null;
  amount: number;
  currency: string;
  details: string;
};

const CURRENCY_LABEL: Record<string, string> = { EGP: "جنيه مصري", USD: "دولار أمريكي", LYD: "دينار ليبي" };

function TreasuriesReport({ inRange }: { inRange: (d: string | null | undefined) => boolean }) {
  const reportPerm = usePerm("reports");
  const settlementPerm = usePerm(CASH_BOX_SETTLEMENT_PERMISSION_KEY);
  const { rows: boxes, loading } = useLive<CashBoxRow>("cash_boxes");
  const { rows: treasurySplits, loading: treasurySplitsLoading } = useLive<TreasuryOperationSplit>("payment_splits");
  const { rows: cTxns } = useLive<CurrencySupplierTx>("currency_supplier_transactions");
  const { rows: cSuppliers } = useLive<CurrencySupplier>("currency_suppliers" as any);
  const supplierNameOf = useMemo(() => new Map(cSuppliers.map((s) => [s.id, s.name])), [cSuppliers]);
  const active = useMemo(() => activeCashBoxes(boxes), [boxes]);
  const boxNameById = useMemo(() => new Map(boxes.map((box) => [box.id, box.name])), [boxes]);


  const treasuryOperations = useMemo(() => {
    const operations: TreasuryOperationRow[] = [];
    const usable = treasurySplits.filter((split) => !split.cancelled_at);
    // Transfers are stored as two payment_splits rows (out + in) with the same source_id.
    const transferGroups = new Map<string, TreasuryOperationSplit[]>();
    for (const split of usable) {
      if (split.source_table !== "cash_box_transfer") continue;
      const key = split.source_id || `legacy:${split.id}`;
      const group = transferGroups.get(key) || [];
      group.push(split);
      transferGroups.set(key, group);
    }
    for (const [key, group] of transferGroups) {
      const out = group.find((split) => split.direction === "out") || null;
      const incoming = group.find((split) => split.direction === "in") || null;
      const sample = out || incoming || group[0];
      if (!sample) continue;
      const dateKey = String(sample.created_at || "").slice(0, 10);
      if (!inRange(dateKey)) continue;
      operations.push({
        id: `transfer:${key}`,
        performedAt: sample.created_at,
        kind: "transfer",
        type: "تحويل بين الخزائن",
        from: out?.cash_box_id ? (boxNameById.get(out.cash_box_id) || "خزينة غير معروفة") : "—",
        to: incoming?.cash_box_id ? (boxNameById.get(incoming.cash_box_id) || "خزينة غير معروفة") : "—",
        fromBoxId: out?.cash_box_id || null,
        toBoxId: incoming?.cash_box_id || null,
        amount: Number(out?.amount ?? incoming?.amount ?? 0),
        currency: String(out?.currency || incoming?.currency || sample.currency || "EGP"),
        details: String(out?.method || incoming?.method || "تحويل بين الخزائن"),
      });
    }

    // Treasury settlements use the treasury source table and a settlement method.
    for (const split of usable) {
      if (split.source_table !== "cash_transfers" || !String(split.method || "").startsWith("تسوية")) continue;
      const dateKey = String(split.created_at || "").slice(0, 10);
      if (!inRange(dateKey)) continue;
      const boxName = split.cash_box_id ? (boxNameById.get(split.cash_box_id) || "خزينة غير معروفة") : "—";
      const isIn = split.direction === "in";
      operations.push({
        id: `settlement:${split.id}`,
        performedAt: split.created_at,
        kind: isIn ? "settlement_in" : "settlement_out",
        type: isIn ? "تسوية زيادة خزنة" : "تسوية عجز خزنة",
        from: isIn ? "تسوية الخزنة" : boxName,
        to: isIn ? boxName : "تسوية الخزنة",
        fromBoxId: isIn ? null : split.cash_box_id,
        toBoxId: isIn ? split.cash_box_id : null,
        amount: Math.abs(Number(split.amount || 0)),
        currency: String(split.currency || "EGP"),
        details: String(split.method || (isIn ? "تسوية زيادة خزنة" : "تسوية عجز خزنة")),
      });
    }

    return operations.sort((a, b) => String(b.performedAt).localeCompare(String(a.performedAt)));
  }, [treasurySplits, boxNameById, inRange]);
  // كل حسابات الخزائن وأسعار الصرف من المحرك الموحد في src/lib/financialSummary.ts.
  const summary = useMemo(
    () => computeTreasurySummary(active, (cTxns || []) as any),
    [active, cTxns],
  );
  const totals = useMemo(
    () => Object.entries(summary.byCurrency).map(([currency, total]) => ({ currency, total })),
    [summary],
  );
  const formatRateSource = (info: { date: string | null; txType: string | null; supplierId: string | null }) => {
    const dateStr = info.date ? toDisplayDate(info.date) : "—";
    if (!info.txType && !info.supplierId) return `آخر سعر صرف مسجل - ${dateStr}`;
    const action = info.txType === "بيع عملة" ? "بيع من مورد العملة" : "شراء من مورد العملة";
    const supplierName = info.supplierId ? supplierNameOf.get(info.supplierId) : null;
    if (!supplierName) return `آخر سعر صرف مسجل - ${dateStr}`;
    return `${action} ${supplierName} - ${dateStr}`;
  };
  const { egp, usd, lyd, usdRate, lydRate, totalEgp, usdInfo, lydInfo } = summary;

  const cols = [
    { header: "اسم الخزينة", key: "name" },
    { header: "العملة", key: "currency" },
    { header: "الرصيد الافتتاحي", key: "opening" },
    { header: "الرصيد", key: "balance" },
    { header: "إجراءات", key: "actions" },
  ];
  const rows = active.map((b) => ({
    name: b.name,
    currency: CURRENCY_LABEL[b.currency] || b.currency,
    opening: fmtNum(Number(b.opening_balance || 0)),
    opening__excel: Number(b.opening_balance || 0),
    balance: fmtNum(Number(b.balance || 0)),
    balance__excel: Number(b.balance || 0),
  }));

  const [historyType, setHistoryType] = useState("");
  const [historyBox, setHistoryBox] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const filteredTreasuryOperations = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return treasuryOperations.filter((op) => {
      if (historyType && op.kind !== historyType) return false;
      if (historyBox && op.fromBoxId !== historyBox && op.toBoxId !== historyBox) return false;
      if (search) {
        const haystack = [op.type, op.from, op.to, op.details, op.currency, String(op.amount)].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [treasuryOperations, historyType, historyBox, historySearch]);
  const clearTreasuryHistoryFilters = () => {
    setHistoryType("");
    setHistoryBox("");
    setHistorySearch("");
  };

  const [editBox, setEditBox] = useState<CashBoxRow | null>(null);
  const [reconcileBox, setReconcileBox] = useState<CashBoxRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div className="card-title">🏦 تقرير الخزائن</div>
        {reportPerm.edit && (
          <button type="button" className="btn btn-gold" onClick={() => setTransferOpen(true)} disabled={active.length < 2}>
            ⇄ تحويل بين الخزائن
          </button>
        )}
      </div>
      <div className="card-body">
        <KpiRow items={[
          ...totals.map((t) => ({
            label: `إجمالي ${CURRENCY_LABEL[t.currency] || t.currency}`,
            value: `${fmtNum(t.total)}`,
            tone: (t.currency === "EGP" ? "gold" : t.currency === "USD" ? "green" : "") as any,
          })),
          { label: "سعر شراء الدولار", value: `${formatExchangeRate(usdRate)} ج.م/$`, tone: "" as any },
          { label: "سعر شراء الدينار", value: `${formatExchangeRate(lydRate)} ج.م/د.ل`, tone: "" as any },
          { label: "مصدر سعر الدولار", value: formatRateSource(usdInfo), tone: "" as any },
          { label: "مصدر سعر الدينار", value: formatRateSource(lydInfo), tone: "" as any },
          { label: "إجمالي أرصدة الخزائن (ج.م)", value: `${fmtNum(totalEgp)} ج.م`, tone: "gold" as any },
        ]} />
        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الخزائن", columns: cols.filter(c=>c.key!=="actions"), rows, fileName: "تقرير الخزائن" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الخزائن", columns: cols.filter(c=>c.key!=="actions"), rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {active.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد خزائن" colSpan={cols.length} />
              ) : active.map((b) => (
                <tr key={b.id}>
                  <td className="bold" data-label="الخزينة">{b.name}</td>
                  <td data-label="العملة">{CURRENCY_LABEL[b.currency] || b.currency}</td>
                  <td data-label="الرصيد الافتتاحي">{fmtNum(Number(b.opening_balance || 0))}</td>
                  <td data-label="الرصيد" style={{ fontWeight: 700 }}>{fmtNum(Number(b.balance || 0))}</td>
                  <td data-label="إجراءات">
                    {reportPerm.edit || settlementPerm.view ? (<>
                      {reportPerm.edit && <button type="button" className="action-btn" onClick={() => setEditBox(b)}>رصيد افتتاحي</button>}
                      {settlementPerm.view && <button type="button" className="action-btn" style={{ marginInlineStart: 6 }} onClick={() => setReconcileBox(b)}>⚖️ تسوية الخزنة</button>}
                    </>) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ marginTop: 16, marginBottom: 0 }}>
          <div className="card-header">
            <div className="card-title">📜 سجل تسويات وتحويلات الخزائن — {filteredTreasuryOperations.length} من {treasuryOperations.length} عملية</div>
          </div>
          <div className="card-body">
            <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <select className="filter-select" value={historyType} onChange={(e) => setHistoryType(e.target.value)} aria-label="فلتر نوع حركة الخزينة">
                <option value="">كل أنواع الحركات</option>
                <option value="transfer">تحويل بين الخزائن</option>
                <option value="settlement_in">تسوية زيادة خزنة</option>
                <option value="settlement_out">تسوية عجز خزنة</option>
              </select>
              <select className="filter-select" value={historyBox} onChange={(e) => setHistoryBox(e.target.value)} aria-label="فلتر الخزينة">
                <option value="">كل الخزائن</option>
                {boxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
              </select>
              <input
                className="search-input"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="بحث في السجل..."
                style={{ minWidth: 220, flex: "1 1 220px" }}
              />
              <button type="button" className="action-btn" onClick={clearTreasuryHistoryFilters} disabled={!historyType && !historyBox && !historySearch}>
                مسح الفلاتر
              </button>
            </div>
            <div className="table-wrap enterprise-table">
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>نوع الحركة</th>
                    <th>من</th>
                    <th>إلى</th>
                    <th>المبلغ</th>
                    <th>العملة</th>
                    <th>التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {treasurySplitsLoading ? (
                    <EmptyOrLoading loading={true} label="" colSpan={7} />
                  ) : filteredTreasuryOperations.length === 0 ? (
                    <EmptyOrLoading loading={false} label="لا توجد تسويات أو تحويلات خزائن مطابقة للفلاتر" colSpan={7} />
                  ) : filteredTreasuryOperations.map((op) => (
                    <tr key={op.id}>
                      <td data-label="التاريخ والوقت" style={{ whiteSpace: "nowrap" }}>{new Date(op.performedAt).toLocaleString("ar-EG")}</td>
                      <td data-label="نوع الحركة">
                        <span className={`badge pill-badge ${op.kind === "transfer" ? "badge-blue" : op.kind === "settlement_in" ? "badge-green" : "badge-red"}`}>{op.type}</span>
                      </td>
                      <td data-label="من">{op.from}</td>
                      <td data-label="إلى">{op.to}</td>
                      <td data-label="المبلغ" style={{ fontWeight: 700 }}>{fmtNum(op.amount)}</td>
                      <td data-label="العملة">{CURRENCY_LABEL[op.currency] || op.currency}</td>
                      <td data-label="التفاصيل">{op.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {editBox && <CashBoxOpeningModal box={editBox} onClose={() => setEditBox(null)} />}
        {reconcileBox && <CashBoxReconcileModal box={reconcileBox} onClose={() => setReconcileBox(null)} />}
        {transferOpen && <CashBoxTransferModal boxes={active} onClose={() => setTransferOpen(false)} />}
      </div>
    </div>
  );
}

function CashBoxOpeningModal({ box, onClose }: { box: CashBoxRow; onClose: () => void }) {
  const [amount, setAmount] = useState<string>(box.opening_balance ? String(box.opening_balance) : "");
  const [date, setDate] = useState<string>(box.opening_date || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string>(box.opening_note || "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await syncCashBoxOpeningBalance(box.id, {
        amount: Number(amount) || 0,
        date,
        note: note.trim() || null,
      });
      toast.success("تم تحديث الرصيد الافتتاحي");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "فشل الحفظ");
    } finally { setSaving(false); }
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 480, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">🏦 رصيد افتتاحي — {box.name}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>القيمة ({CURRENCY_LABEL[box.currency] || box.currency})</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group"><label>التاريخ</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="form-group full"><label>ملاحظات</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CashBoxTransferModal({ boxes, onClose }: { boxes: CashBoxRow[]; onClose: () => void }) {
  const supportedBoxes = useMemo(
    () => boxes.filter((box) => box.is_active && ["EGP", "USD", "LYD"].includes(String(box.currency || "").toUpperCase())),
    [boxes],
  );
  const cashDefault = supportedBoxes.find((box) => /نقد|cash/i.test(box.name));
  const instaDefault = supportedBoxes.find((box) => /انستا|insta/i.test(box.name) && box.id !== cashDefault?.id);
  const [fromId, setFromId] = useState(cashDefault?.id || supportedBoxes[0]?.id || "");
  const [toId, setToId] = useState(instaDefault?.id || supportedBoxes.find((box) => box.id !== (cashDefault?.id || supportedBoxes[0]?.id))?.id || "");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const fromBox = supportedBoxes.find((box) => box.id === fromId) || null;
  const destinationOptions = supportedBoxes.filter(
    (box) => box.id !== fromId && (!fromBox || box.currency === fromBox.currency),
  );
  const toBox = destinationOptions.find((box) => box.id === toId) || null;
  const amountNum = Number(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;

  useEffect(() => {
    if (!fromBox) return;
    if (toBox) return;
    setToId(destinationOptions[0]?.id || "");
  }, [fromBox, toBox, destinationOptions]);

  const swap = () => {
    if (!fromBox || !toBox) return;
    setFromId(toBox.id);
    setToId(fromBox.id);
  };

  const save = async () => {
    if (!fromBox || !toBox) { toast.error("اختر الخزينة المحول منها والخزينة المحول إليها"); return; }
    if (fromBox.id === toBox.id) { toast.error("لا يمكن التحويل إلى نفس الخزينة"); return; }
    if (fromBox.currency !== toBox.currency) { toast.error("التحويل المباشر يجب أن يكون بين خزائن بنفس العملة"); return; }
    if (!validAmount) { toast.error("أدخل مبلغ تحويل صحيح أكبر من صفر"); return; }

    setSaving(true);
    try {
      const outflowError = await checkOutflowAllowed(fromBox.id, amountNum, fromBox.name);
      if (outflowError) { toast.error(outflowError); return; }

      const method = `تحويل بين الخزائن: ${fromBox.name} ← ${toBox.name}`;
      const result = await postCashBoxTransfer({
        fromCashBoxId: fromBox.id,
        toCashBoxId: toBox.id,
        amount: amountNum,
        currency: fromBox.currency as "EGP" | "USD" | "LYD",
        date: new Date().toISOString().slice(0, 10),
        method,
      });
      if (!result.ok) throw new Error(result.error || "فشل التحويل بين الخزائن");
      await refetchLiveTables(["cash_boxes", "payment_splits"]);
      toast.success(`تم تحويل ${fmtNum(amountNum)} ${CURRENCY_LABEL[fromBox.currency] || fromBox.currency} من ${fromBox.name} إلى ${toBox.name}`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "فشل التحويل بين الخزائن");
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 560, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">⇄ تحويل بين خزائن الشركة</div></div>
        <div className="form-grid">
          <div className="form-group">
            <label>من خزينة *</label>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {supportedBoxes.map((box) => (
                <option key={box.id} value={box.id}>{box.name} — {fmtNum(Number(box.balance || 0))} {box.currency}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>إلى خزينة *</label>
            <select value={toId} onChange={(e) => setToId(e.target.value)} disabled={!fromBox || destinationOptions.length === 0}>
              {destinationOptions.map((box) => (
                <option key={box.id} value={box.id}>{box.name} — {fmtNum(Number(box.balance || 0))} {box.currency}</option>
              ))}
            </select>
          </div>
          <div className="form-group full" style={{ display: "flex", justifyContent: "center" }}>
            <button type="button" className="action-btn" onClick={swap} disabled={!fromBox || !toBox || saving}>⇅ عكس اتجاه التحويل</button>
          </div>
          <div className="form-group full">
            <label>المبلغ *</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          {fromBox && toBox && (
            <div className="form-group full">
              <div className="card" style={{ margin: 0, padding: 10, background: "var(--surface, #f8f9fb)" }}>
                <div><strong>الخزينة المصدر:</strong> {fromBox.name} — الرصيد الحالي {fmtNum(Number(fromBox.balance || 0))} {fromBox.currency}</div>
                <div><strong>الخزينة المستلمة:</strong> {toBox.name} — الرصيد الحالي {fmtNum(Number(toBox.balance || 0))} {toBox.currency}</div>
                {validAmount && <div><strong>المبلغ:</strong> {fmtNum(amountNum)} {fromBox.currency}</div>}
              </div>
            </div>
          )}
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={saving || !fromBox || !toBox || !validAmount}>
            {saving ? "جارٍ التحويل..." : "⇄ تنفيذ التحويل"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CashBoxReconcileModal({ box, onClose }: { box: CashBoxRow; onClose: () => void }) {
  const settlementPerm = usePerm(CASH_BOX_SETTLEMENT_PERMISSION_KEY);
  const currentBalance = Number(box.balance || 0);
  const currencyLabel = CURRENCY_LABEL[box.currency] || box.currency;
  const [physical, setPhysical] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const physicalNum = Number(physical);
  const hasPhysical = physical.trim() !== "" && !Number.isNaN(physicalNum);
  const diff = hasPhysical ? physicalNum - currentBalance : 0;
  const diffLabel = diff > 0 ? "تسوية زيادة خزنة" : diff < 0 ? "تسوية عجز خزنة" : "لا يوجد فرق";

  const save = async () => {
    if (!settlementPerm.view) { toast.error("ليس لديك صلاحية تسوية الخزائن"); return; }
    if (!hasPhysical) { toast.error("أدخل الرصيد الفعلي بعد الجرد"); return; }
    if (!reason.trim()) { toast.error("سبب التسوية إجباري"); return; }
    if (diff === 0) { toast.error("لا يوجد فرق لتسويته"); return; }
    setSaving(true);
    try {
      const amount = Math.abs(diff);
      const direction: "in" | "out" = diff > 0 ? "in" : "out";
      const method = diff > 0 ? "تسوية زيادة خزنة" : "تسوية عجز خزنة";
      const statement = `${method} — الرصيد قبل: ${currentBalance} ${box.currency} | الرصيد بعد: ${physicalNum} ${box.currency} | الفرق: ${diff} ${box.currency} | السبب: ${reason.trim()}${note.trim() ? ` | ملاحظات: ${note.trim()}` : ""}`;
      const res = await postMovement({
        partyType: "treasury",
        partyId: null,
        kind: "settlement",
        date: new Date().toISOString().slice(0, 10),
        note: note.trim() || undefined,
        statement,
        splits: [{
          method,
          currency: box.currency as "EGP" | "USD" | "LYD",
          cashBoxId: box.id,
          amount,
          direction,
        }],
      });
      if (!res.ok) throw new Error(res.error || "فشل حفظ التسوية");
      toast.success("تم حفظ تسوية الخزنة");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "فشل حفظ التسوية");
    } finally { setSaving(false); }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 520, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">⚖️ تسوية الخزنة — {box.name}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم الخزنة</label>
            <input value={box.name} readOnly />
          </div>
          <div className="form-group"><label>العملة</label>
            <input value={currencyLabel} readOnly />
          </div>
          <div className="form-group"><label>الرصيد الحالي</label>
            <input value={fmtNum(currentBalance)} readOnly />
          </div>
          <div className="form-group"><label>الرصيد الفعلي بعد الجرد *</label>
            <input type="number" value={physical} onChange={(e) => setPhysical(e.target.value)} />
          </div>
          <div className="form-group full"><label>سبب التسوية *</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: عجز جرد، فرق تقريب، خطأ إدخال..." />
          </div>
          <div className="form-group full"><label>ملاحظات</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {hasPhysical && (
            <div className="form-group full">
              <div className="card" style={{ margin: 0, padding: 10, background: "var(--surface, #f8f9fb)" }}>
                <div><strong>نوع الحركة:</strong> {diffLabel}</div>
                <div><strong>قيمة الفرق:</strong> {fmtNum(diff)} {box.currency}</div>
                <div><strong>الرصيد المتوقع بعد التسوية:</strong> {fmtNum(physicalNum)} {box.currency}</div>
              </div>
            </div>
          )}
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={save} disabled={saving || !hasPhysical || !reason.trim() || diff === 0}>💾 حفظ التسوية</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}




// ---------- CURRENCY SUPPLIERS (buy / sell currency) ----------
type CurrencySupplierTx = {
  id: string;
  supplier_id: string;
  tx_date: string;
  tx_type: "شراء عملة" | "بيع عملة";
  bought_currency: string;
  bought_amount: number;
  sold_currency: string;
  sold_amount: number;
  exchange_rate: number | null;
  description: string | null;
  created_at: string;
};
type CurrencySupplier = { id: string; name: string };

function CurrencySuppliersReport({ inRange }: { inRange: RangeFn }) {
  const { rows: txns, loading } = useLive<CurrencySupplierTx>("currency_supplier_transactions" as any);
  const { rows: suppliers } = useLive<CurrencySupplier>("currency_suppliers" as any);
  const nameOf = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  const filtered = useMemo(() => txns.filter((t) => inRange(t.tx_date)), [txns, inRange]);

  const totals = useMemo(() => summarizeCurrencySupplierTrades(filtered), [filtered]);


  const cols = [
    { header: "التاريخ", key: "tx_date" },
    { header: "المورد", key: "supplier" },
    { header: "نوع الحركة", key: "tx_type" },
    { header: "العملة المشتراة", key: "bought_currency" },
    { header: "قيمة العملة المشتراة", key: "bought_amount" },
    { header: "العملة المباعة", key: "sold_currency" },
    { header: "قيمة العملة المباعة", key: "sold_amount" },
    { header: "سعر الصرف", key: "rate" },
    { header: "البيان", key: "description" },
  ];
  const rows = filtered.map((t) => ({
    tx_date: t.tx_date,
    supplier: nameOf.get(t.supplier_id) || "—",
    tx_type: t.tx_type,
    bought_currency: t.bought_currency,
    bought_amount: fmtNum(Number(t.bought_amount || 0)),
    bought_amount__excel: Number(t.bought_amount || 0),
    sold_currency: t.sold_currency,
    sold_amount: fmtNum(Number(t.sold_amount || 0)),
    sold_amount__excel: Number(t.sold_amount || 0),
    rate: formatExchangeRate(t.exchange_rate),
    description: t.description || "",
  }));

  const kpiItems: { label: string; value: string; tone?: "green" | "red" | "gold" | "" }[] = [
    { label: "عدد حركات الشراء", value: fmtNum(totals.buyCount), tone: "green" },
    { label: "عدد حركات البيع", value: fmtNum(totals.sellCount), tone: "red" },
  ];
  totals.boughtByCurrency.entries().forEach(({ currency, amount }) => kpiItems.push({ label: `إجمالي ${currency} (شراء)`, value: fmtNum(amount), tone: "gold" }));
  totals.soldByCurrency.entries().forEach(({ currency, amount }) => kpiItems.push({ label: `إجمالي ${currency} (بيع)`, value: fmtNum(amount) }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💱 تقرير شراء وبيع العملات</div></div>
      <div className="card-body">
        <KpiRow items={kpiItems} />
        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير شراء وبيع العملات", columns: cols, rows, fileName: "تقرير شراء وبيع العملات" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير شراء وبيع العملات", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد حركات" colSpan={cols.length} />
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td data-label="التاريخ">{r.tx_date}</td>
                  <td className="bold" data-label="المورد">{r.supplier}</td>
                  <td data-label="النوع">{r.tx_type}</td>
                  <td data-label="مشتراة">{r.bought_currency}</td>
                  <td data-label="قيمة الشراء">{r.bought_amount}</td>
                  <td data-label="مباعة">{r.sold_currency}</td>
                  <td data-label="قيمة البيع">{r.sold_amount}</td>
                  <td data-label="سعر الصرف">{r.rate}</td>
                  <td data-label="البيان">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
