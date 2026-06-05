import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  fmtDL,
  fmtNum,
  fmtUSD,
  merchantCashGross,
  merchantCashNet,
  tripValue,
  txnTotalPaid,
  type CompanyTransaction,
  type UsdTreasuryTransaction,
} from "@/lib/db";
import { useReportsData, type ReportsData } from "@/lib/reportsData";
import { exportStatementToExcel, exportStatementToPDF } from "@/lib/exportStatement";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
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

type Tab = "agents" | "companies" | "merchants" | "investors" | "expenses" | "usd_treasury";
type Period = "30d" | "1y" | "custom";

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

function KpiRow({ items }: { items: { label: string; value: string; tone?: "green" | "red" | "gold" | ""; icon?: React.ReactNode; sub?: string }[] }) {
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
    { id: "merchants", label: "فودافون كاش", icon: <Handshake size={15} strokeWidth={2} /> },
    { id: "investors", label: "المستثمرين", icon: <Briefcase size={15} strokeWidth={2} /> },
    { id: "expenses", label: "المصروفات", icon: <Receipt size={15} strokeWidth={2} /> },
    { id: "usd_treasury", label: "الخزينة الدولارية", icon: <DollarSign size={15} strokeWidth={2} /> },
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
      {tab === "investors" && <InvestorsReport inRange={inRange} data={data} />}
      {/* flights/approvals tabs removed — section unified into submissions/executions */}
      {tab === "expenses" && <ExpensesReport inRange={inRange} data={data} />}
      {tab === "usd_treasury" && <UsdTreasuryReport inRange={inRange} data={data} />}
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

// ---------- AGENTS ----------
function AgentsReport({ inRange, data: rd }: SectionProps) {
  const { agents, transactions: txns, flights, approvals, loading } = rd;

  const data = useMemo(() => agents.map((a) => {
    const ts = txns.filter((t) => t.agent_id === a.id && inRange(t.date));
    const fl = flights.filter((f) => f.agent_id === a.id && inRange(f.travel_date));
    const ap = approvals.filter((p) => p.agent_id === a.id && inRange(p.submit_date));
    const total = ts.reduce((s, t) => s + tripValue(t), 0);
    const paid = ts.reduce((s, t) => s + txnTotalPaid(t), 0);
    return { name: a.name, total, paid, due: total - paid, flights: fl.length, approvals: ap.length };
  }), [agents, txns, flights, approvals, inRange]);

  const fTxns = txns.filter((t) => inRange(t.date));
  const fFlights = flights.filter((f) => inRange(f.travel_date));
  const approvalDate = (a: typeof approvals[number]) =>
    (a.submit_date && String(a.submit_date)) ||
    (a.travel_date && String(a.travel_date)) ||
    (a.issue_date && String(a.issue_date)) ||
    (a.created_at ? String(a.created_at).slice(0, 10) : null);
  const fApp = approvals.filter((a) => inRange(approvalDate(a)));

  const monthlyCollections = groupByMonth(fTxns, (t) => t.date, (t) => txnTotalPaid(t));
  const flightsByDestination = groupBy(fFlights, (f) => f.destination || "غير محدد");
  const approvalsByStatus = groupBy(fApp, (a) => a.status || "—");
  const APPROVAL_STATUS_COLORS: Record<string, string> = {
    "سريعة": "#16A34A",
    "بطيئة": "#F59E0B",
    "رفض أمني": "#DC2626",
    "مرفوض": "#DC2626",
    "قيد المراجعة": "#3B82F6",
    "معلق": "#6B7280",
  };
  const totalApprovals = approvalsByStatus.reduce((s, x) => s + (x.value || 0), 0);
  const topAgents = [...data].sort((a, b) => b.paid - a.paid).slice(0, 5).map((d) => ({ name: d.name, value: d.paid }));

  const totalCollections = fTxns.reduce((s, t) => s + txnTotalPaid(t), 0);
  const totalValue = fTxns.reduce((s, t) => s + tripValue(t), 0);

  const cols = [
    { header: "اسم الوكيل", key: "name" },
    { header: "إجمالي قيمة الرحلات", key: "total" },
    { header: "إجمالي المدفوع", key: "paid" },
    { header: "صافي المستحق", key: "due" },
    { header: "عدد الرحلات", key: "flights" },
    { header: "عدد الموافقات", key: "approvals" },
  ];
  const rows = data.map((r) => ({
    ...r,
    total: fmtDL(r.total), total__excel: r.total,
    paid: fmtDL(r.paid), paid__excel: r.paid,
    due: fmtDL(r.due), due__excel: r.due,
    flights: fmtNum(r.flights), flights__excel: r.flights,
    approvals: fmtNum(r.approvals), approvals__excel: r.approvals,
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">👥 تقرير الوكلاء</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "إجمالي التحصيلات", value: fmtDL(totalCollections), tone: "green" },
          { label: "إجمالي قيمة الخدمات", value: fmtDL(totalValue), tone: "gold" },
          { label: "عدد الرحلات", value: fmtNum(fFlights.length) },
          { label: "عدد الموافقات", value: fmtNum(fApp.length) },
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

          <ChartCard title="الرحلات حسب الوجهة" subtitle="عدد الرحلات لكل وجهة" isEmpty={flightsByDestination.length === 0}>
            <BarChart data={flightsByDestination} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={axisTick} allowDecimals={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtCount(v), "عدد الرحلات"]} />
              <Bar dataKey="value" name="عدد الرحلات" fill={COLORS.positive} radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartCard>

          <ChartCard title="الموافقات الأمنية حسب الحالة" subtitle="توزيع الموافقات على الحالات" isEmpty={approvalsByStatus.length === 0}>
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
          onExcel={() => exportStatementToExcel({ title: "تقرير الوكلاء", columns: cols, rows, fileName: "agents-report" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الوكلاء", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا يوجد وكلاء" colSpan={cols.length} />
              ) : data.map((r, i) => (
                <tr key={i}>
                  <td className="bold" data-label="الوكيل">{r.name}</td>
                  <td data-label="القيمة">{fmtDL(r.total)}</td>
                  <td data-label="المدفوع">{fmtDL(r.paid)}</td>
                  <td data-label="المستحق">{fmtDL(r.due)}</td>
                  <td data-label="رحلات">{fmtNum(r.flights)}</td>
                  <td data-label="موافقات">{fmtNum(r.approvals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- COMPANIES ----------
function CompaniesReport({ inRange, data: rd }: SectionProps) {
  const { companies, companyTransactions: cTxns, approvals, loading } = rd;

  const paidOf = (t: CompanyTransaction) =>
    Number(t.instapay_amount || 0) + Number(t.cash_amount || 0) + merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);

  const data = useMemo(() => companies.map((c) => {
    const ts = cTxns.filter((t) => t.company_id === c.id && inRange(t.date));
    const ap = approvals.filter((a) => a.issuing_company_id === c.id && inRange(a.submit_date));
    const total = ts.reduce((s, t) => s + (Number(t.trip_value || 0) || Number(t.count || 0) * Number(t.price || 0)), 0);
    const paid = ts.reduce((s, t) => s + paidOf(t), 0);
    return { name: c.company_name, total, paid, due: total - paid, count: ts.length + ap.length };
  }), [companies, cTxns, approvals, inRange]);

  const fCT = cTxns.filter((t) => inRange(t.date));
  const monthlyPayments = groupByMonth(fCT, (t) => t.date, (t) => paidOf(t));
  const topCompanies = [...data].sort((a, b) => b.count - a.count).slice(0, 5).map((d) => ({ name: d.name, value: d.count }));
  const servicesByCompany = data.filter((d) => d.paid > 0).slice(0, 6).map((d) => ({ name: d.name, value: d.paid }));

  const totalPaid = fCT.reduce((s, t) => s + paidOf(t), 0);

  const cols = [
    { header: "اسم الشركة", key: "name" },
    { header: "إجمالي الخدمات", key: "total" },
    { header: "إجمالي المدفوع", key: "paid" },
    { header: "صافي المستحق", key: "due" },
    { header: "عدد الحركات/الموافقات", key: "count" },
  ];
  const rows = data.map((r) => ({
    ...r,
    total: fmtDL(r.total), total__excel: r.total,
    paid: fmtDL(r.paid), paid__excel: r.paid,
    due: fmtDL(r.due), due__excel: r.due,
    count: fmtNum(r.count), count__excel: r.count,
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🏢 تقرير الشركات الصادرة</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "إجمالي المدفوعات", value: fmtDL(totalPaid), tone: "red" },
          { label: "عدد الشركات", value: fmtNum(companies.length) },
          { label: "إجمالي الحركات", value: fmtNum(fCT.length) },
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
                {servicesByCompany.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
            </PieChart>
          </ChartCard>
        </ChartsGrid>

        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الشركات الصادرة", columns: cols, rows, fileName: "companies-report" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الشركات الصادرة", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد شركات" colSpan={cols.length} />
              ) : data.map((r, i) => (
                <tr key={i}>
                  <td className="bold" data-label="الشركة">{r.name}</td>
                  <td data-label="الخدمات">{fmtDL(r.total)}</td>
                  <td data-label="المدفوع">{fmtDL(r.paid)}</td>
                  <td data-label="المستحق">{fmtDL(r.due)}</td>
                  <td data-label="العدد">{fmtNum(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- MERCHANTS ----------
function MerchantsReport({ inRange, data: rd }: SectionProps) {
  const { merchants, transactions: txns, companyTransactions: cTxns, merchantCollections: collections, loading } = rd;

  const data = useMemo(() => merchants.map((m) => {
    const inc = txns.filter((t) => t.merchant_id === m.id && inRange(t.date));
    const out = cTxns.filter((t) => t.merchant_id === m.id && inRange(t.date));
    const col = collections.filter((c) => c.merchant_id === m.id && inRange(c.date));
    const incomingNet = inc.reduce((s, t) => s + merchantCashNet(t), 0);
    const incomingGross = inc.reduce((s, t) => s + merchantCashGross(t), 0);
    const outgoing = out.reduce((s, t) => s + Number(t.merchant_cash_amount || 0), 0);
    const collected = col.reduce((s, c) => s + Number(c.amount || 0), 0);
    const fee = incomingGross - incomingNet;
    return { name: m.merchant_name, incoming: incomingNet, outgoing, collected, fee, balance: incomingNet - outgoing - collected };
  }), [merchants, txns, cTxns, collections, inRange]);

  const flow = data.map((d) => ({ name: d.name, "وارد": d.incoming, "صادر": d.outgoing }));
  const fees = data.filter((d) => d.fee > 0).map((d) => ({ name: d.name, value: d.fee }));
  const balances = data.map((d) => ({ name: d.name, value: d.balance }));

  const totIn = data.reduce((s, d) => s + d.incoming, 0);
  const totOut = data.reduce((s, d) => s + d.outgoing, 0);
  const totFee = data.reduce((s, d) => s + d.fee, 0);

  const cols = [
    { header: "اسم التاجر", key: "name" },
    { header: "وارد فودافون كاش من الوكلاء", key: "incoming" },
    { header: "صادر فودافون كاش للشركات", key: "outgoing" },
    { header: "النقدية المحصلة", key: "collected" },
    { header: "نسبة 1%", key: "fee" },
    { header: "الرصيد", key: "balance" },
  ];
  const rows = data.map((r) => ({
    ...r,
    incoming: fmtDL(r.incoming), incoming__excel: r.incoming,
    outgoing: fmtDL(r.outgoing), outgoing__excel: r.outgoing,
    collected: fmtDL(r.collected), collected__excel: r.collected,
    fee: fmtDL(r.fee), fee__excel: r.fee,
    balance: fmtDL(r.balance), balance__excel: r.balance,
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🤝 تقرير فودافون كاش</div></div>
      <div className="card-body">
        <KpiRow items={[
          { label: "إجمالي الوارد", value: fmtDL(totIn), tone: "green" },
          { label: "إجمالي الصادر", value: fmtDL(totOut), tone: "red" },
          { label: "عمولات 1%", value: fmtDL(totFee), tone: "gold" },
          { label: "عدد التجار", value: fmtNum(merchants.length) },
        ]} />

        <ChartsGrid>
          <ChartCard title="حركة فودافون كاش" subtitle="مقارنة بين الوارد والصادر لكل تاجر" isEmpty={flow.length === 0}>
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

          <ChartCard title="عمولات التجار 1%" subtitle="إجمالي العمولات لكل تاجر" isEmpty={fees.length === 0}>
            <BarChart data={fees} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="name" tick={axisTick} interval={0} angle={-15} textAnchor="end" height={60} />
              <YAxis tick={axisTick} tickFormatter={fmtCount} width={60} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(v: number) => [fmtTip(v), "العمولة"]} />
              <Bar dataKey="value" name="العمولة" fill={COLORS.warning} radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartCard>

          <ChartCard title="أرصدة التجار" subtitle="الرصيد الحالي لكل تاجر" isEmpty={balances.length === 0}>
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
          onExcel={() => exportStatementToExcel({ title: "تقرير فودافون كاش", columns: cols, rows, fileName: "merchants-report" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير فودافون كاش", columns: cols, rows })}
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
                  <td data-label="وارد">{fmtDL(r.incoming)}</td>
                  <td data-label="صادر">{fmtDL(r.outgoing)}</td>
                  <td data-label="محصل">{fmtDL(r.collected)}</td>
                  <td data-label="نسبة">{fmtDL(r.fee)}</td>
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

// ---------- INVESTORS ----------
function InvestorsReport({ inRange, data: rd }: SectionProps) {
  const { investors, investorTransactions: invTxns, loading } = rd;

  const data = useMemo(() => investors.map((inv) => {
    const ts = invTxns.filter((t) => t.investor_id === inv.id && inRange(t.date));
    const dep = ts.filter((t) => t.transaction_type === "توريد نقدية").reduce((s, t) => s + Number(t.amount || 0), 0);
    const wd = ts.filter((t) => t.transaction_type === "صرف نقدية").reduce((s, t) => s + Number(t.amount || 0), 0);
    return { name: inv.investor_name, deposit: dep, withdraw: wd, balance: dep - wd };
  }), [investors, invTxns, inRange]);

  const fIT = invTxns.filter((t) => inRange(t.date));
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

  const totDep = data.reduce((s, d) => s + d.deposit, 0);
  const totWd = data.reduce((s, d) => s + d.withdraw, 0);
  const totBal = data.reduce((s, d) => s + d.balance, 0);

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
          onExcel={() => exportStatementToExcel({ title: "تقرير المستثمرين", columns: cols, rows, fileName: "investors-report" })}
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
      <div className="card-header"><div className="card-title">✈️ تقرير الرحلات</div></div>
      <div className="card-body">
        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الرحلات", columns: cols, rows, fileName: "flights-report" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الرحلات", columns: cols, rows })}
        />
        <div className="table-wrap">
          <table className="mobile-cards">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyOrLoading loading={loading} label="لا توجد رحلات" colSpan={cols.length} />
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
    company: a.issuing_company || companyName(a.issuing_company_id),
    destination: a.destination || "—",
    authority: a.authority || "—",
    submit: a.submit_date || "—",
    issue: a.issue_date || "—",
    amount: fmtDL(Number((a as any).agent_price || a.price || 0)),
    status: a.status,
  }));

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📋 تقرير الموافقات الأمنية</div></div>
      <div className="card-body">
        <ExportBar
          onExcel={() => exportStatementToExcel({ title: "تقرير الموافقات الأمنية", columns: cols, rows, fileName: "approvals-report" })}
          onPdf={() => exportStatementToPDF({ title: "تقرير الموافقات الأمنية", columns: cols, rows })}
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
  const totalAll = data.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalFixed = data.filter((e) => e.expense_type === "ثابت").reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalVar = data.filter((e) => e.expense_type === "متغير").reduce((s, e) => s + Number(e.amount || 0), 0);

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
    { header: "ملاحظات", key: "notes" },
  ];
  const rows = data.map((e) => ({
    name: e.expense_name,
    type: e.expense_type,
    amount: fmtDL(Number(e.amount || 0)),
    date: e.date,
    method: e.payment_method,
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
          onExcel={() => exportStatementToExcel({ title: "تقرير المصروفات", columns: cols, rows, summary, fileName: "expenses-report" })}
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
  merchant_wallet: "فودافون كاش",
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

  // All-time sorted asc to build running balance, then filter for display
  const allSorted = useMemo(() => {
    return [...usdTreasury].sort((a, b) => {
      const da = (a.date || "") + " " + (a.created_at || "");
      const db = (b.date || "") + " " + (b.created_at || "");
      return da.localeCompare(db);
    });
  }, [usdTreasury]);

  const withBalance = useMemo(() => {
    let bal = 0;
    return allSorted.map((r) => {
      const amt = Number(r.usd_amount || 0);
      bal += r.type === "company_payment" ? -amt : amt;
      return { row: r, balance: bal };
    });
  }, [allSorted]);

  const filtered = useMemo(
    () => withBalance.filter((x) => inRange(x.row.date)).reverse(),
    [withBalance, inRange],
  );

  // KPIs (period scope)
  const periodConversions = filtered
    .filter((x) => x.row.type === "conversion")
    .reduce((s, x) => s + Number(x.row.usd_amount || 0), 0);
  const periodPayments = filtered
    .filter((x) => x.row.type === "company_payment")
    .reduce((s, x) => s + Number(x.row.usd_amount || 0), 0);
  const periodEgpUsed = filtered
    .filter((x) => x.row.type === "conversion")
    .reduce((s, x) => s + Number(x.row.egp_amount || 0), 0);
  const currentBalance = withBalance.length ? withBalance[withBalance.length - 1].balance : 0;

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
  ];

  const rows = filtered.map((x) => {
    const r = x.row;
    const isMerchantSrc = r.source_type === "merchant_wallet" || r.source_type === "merchant_physical";
    return {
      date: r.date,
      movement: usdMovementLabel(r),
      egp: fmtDL(Number(r.egp_amount || 0)),
      egp__excel: Number(r.egp_amount || 0),
      rate: r.exchange_rate ? Number(r.exchange_rate).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—",
      rate__excel: Number(r.exchange_rate || 0),
      usd: fmtUSD(Number(r.usd_amount || 0)),
      usd__excel: Number(r.usd_amount || 0),
      source: USD_SOURCE_LABELS[r.source_type || ""] || "—",
      merchant: isMerchantSrc ? merchantName(r.merchant_id) : "—",
      company: r.company_id ? companyName(r.company_id) : "—",
      service: r.note || "—",
      note: r.note || "—",
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
          onExcel={() => exportStatementToExcel({ title: "تقرير الخزينة الدولارية", columns: cols, rows, fileName: "usd-treasury-report" })}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
