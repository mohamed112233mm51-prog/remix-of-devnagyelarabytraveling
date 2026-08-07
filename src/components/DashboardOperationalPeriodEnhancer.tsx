import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Briefcase,
  Building2,
  ClipboardCheck,
  Landmark,
  Plane,
  TrendingUp,
  Users,
} from "lucide-react";
import { CurrencyLines } from "@/components/CurrencyLines";
import { useAgentPeriodTotals } from "@/hooks/useAgentPeriodTotals";
import { useMerchantPeriodTotals } from "@/hooks/useMerchantPeriodTotals";
import { useCurrencySuppliersPeriodTotals } from "@/hooks/useCurrencySuppliersPeriodTotals";
import { useDashboardOperationalPeriod } from "@/hooks/useDashboardOperationalPeriod";
import { fmtDL, fmtNum } from "@/lib/db";
import { CurrencyMap } from "@/lib/financialSummary";
import { getDashboardPeriodProfitSummaryData } from "@/lib/dashboardPeriodProfit.functions";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const PERIOD_BY_LABEL: Record<string, SummaryPeriod> = {
  اليوم: "today",
  "هذا الأسبوع": "week",
  "هذا الشهر": "month",
  "السنة الحالية": "year",
  "إجمالي النظام": "all",
};

const PERIOD_LABELS: Record<SummaryPeriod, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
  year: "السنة الحالية",
  all: "إجمالي النظام",
};

type PortalSlots = {
  profitHero: HTMLElement | null;
  submissionCount: HTMLElement | null;
  executionCount: HTMLElement | null;
  periodSummary: HTMLElement | null;
  topAgents: HTMLElement | null;
  topCompanies: HTMLElement | null;
  serviceDistribution: HTMLElement | null;
  topDestinations: HTMLElement | null;
  supplierDetails: HTMLElement | null;
  profitDetails: HTMLElement | null;
};

const EMPTY_SLOTS: PortalSlots = {
  profitHero: null,
  submissionCount: null,
  executionCount: null,
  periodSummary: null,
  topAgents: null,
  topCompanies: null,
  serviceDistribution: null,
  topDestinations: null,
  supplierDetails: null,
  profitDetails: null,
};

const SLOT_IDS = [
  "dashboard-profit-hero-period-slot",
  "dashboard-submission-count-period-slot",
  "dashboard-execution-count-period-slot",
  "dashboard-period-summary-slot",
  "dashboard-top-agents-period-slot",
  "dashboard-top-companies-period-slot",
  "dashboard-service-distribution-period-slot",
  "dashboard-top-destinations-period-slot",
  "dashboard-supplier-details-period-slot",
  "dashboard-profit-details-period-slot",
];

export function DashboardOperationalPeriodEnhancer() {
  const [dashboardMounted, setDashboardMounted] = useState(false);

  useEffect(() => {
    const sync = () => setDashboardMounted(Boolean(document.querySelector(".erp-period-bar")));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return dashboardMounted ? <DashboardOperationalPeriodPortals /> : null;
}

function DashboardOperationalPeriodPortals() {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const [slots, setSlots] = useState<PortalSlots>(EMPTY_SLOTS);
  const operational = useDashboardOperationalPeriod(period);
  const agentTotals = useAgentPeriodTotals(period);
  const merchantTotals = useMerchantPeriodTotals(period);
  const supplierTotals = useCurrencySuppliersPeriodTotals(period);

  const totalCollections = useMemo(() => {
    const total = new CurrencyMap();
    total.merge(agentTotals.credit);
    total.merge(merchantTotals.totalCollected);
    return total;
  }, [agentTotals.credit, merchantTotals.totalCollected]);

  const profitSummaryFn = useServerFn(getDashboardPeriodProfitSummaryData);
  const profitQuery = useQuery({
    queryKey: ["dashboard-period-profit-summary", period],
    enabled: Boolean(slots.profitHero || slots.profitDetails),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => profitSummaryFn({ data: { period } }),
  });

  useEffect(() => {
    const periodBar = document.querySelector<HTMLElement>(".erp-period-bar");
    if (!periodBar) return;

    const syncPeriod = () => {
      const active = periodBar.querySelector<HTMLElement>(".erp-period-tab.is-active");
      const next = PERIOD_BY_LABEL[active?.textContent?.trim() || ""];
      if (next) setPeriod(next);
    };

    syncPeriod();
    const onClick = () => requestAnimationFrame(syncPeriod);
    periodBar.addEventListener("click", onClick);
    const observer = new MutationObserver(syncPeriod);
    observer.observe(periodBar, { attributes: true, subtree: true, attributeFilter: ["class"] });

    return () => {
      periodBar.removeEventListener("click", onClick);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const findFollowingGrid = (sectionTitle: string, selector: string): HTMLElement | null => {
      const title = Array.from(document.querySelectorAll<HTMLElement>(".erp-section-title"))
        .find((node) => node.textContent?.trim() === sectionTitle);
      let sibling = title?.nextElementSibling as HTMLElement | null;
      while (sibling) {
        if (sibling.matches(selector)) return sibling;
        if (sibling.classList.contains("erp-section-title")) return null;
        sibling = sibling.nextElementSibling as HTMLElement | null;
      }
      return null;
    };

    const findPrimaryGrid = (): HTMLElement | null => {
      const periodBar = document.querySelector<HTMLElement>(".erp-period-bar");
      let sibling = periodBar?.nextElementSibling as HTMLElement | null;
      while (sibling) {
        if (sibling.matches(".erp-hero-grid")) return sibling;
        if (sibling.classList.contains("erp-section-title")) return null;
        sibling = sibling.nextElementSibling as HTMLElement | null;
      }
      return null;
    };

    const findHero = (grid: HTMLElement | null, label: string): HTMLElement | null => {
      if (!grid) return null;
      return Array.from(grid.querySelectorAll<HTMLElement>(":scope > .erp-hero"))
        .find((card) => card.querySelector<HTMLElement>(".erp-hero-label")?.textContent?.trim() === label) || null;
    };

    const findHeroByPrefix = (grid: HTMLElement | null, prefix: string): HTMLElement | null => {
      if (!grid) return null;
      return Array.from(grid.querySelectorAll<HTMLElement>(":scope > .erp-hero"))
        .find((card) => card.querySelector<HTMLElement>(".erp-hero-label")?.textContent?.trim().startsWith(prefix)) || null;
    };

    const findPanel = (title: string): HTMLElement | null =>
      Array.from(document.querySelectorAll<HTMLElement>(".erp-panel"))
        .find((panel) => panel.querySelector<HTMLElement>(".erp-panel-title")?.textContent?.trim() === title) || null;

    const findDetailsCard = (grid: HTMLElement | null, title: string): HTMLElement | null => {
      if (!grid) return null;
      return Array.from(grid.querySelectorAll<HTMLElement>(":scope > .dash-card"))
        .find((card) => card.querySelector<HTMLElement>(".dash-card-title")?.textContent?.trim() === title) || null;
    };

    const makeSlot = (original: HTMLElement | null, id: string): HTMLElement | null => {
      if (!original?.parentElement) return null;
      const parent = original.parentElement;
      const existing = parent.querySelector<HTMLElement>(`#${id}`);
      if (existing) {
        original.dataset.dashboardOperationalOriginal = id;
        original.style.display = "none";
        return existing;
      }

      const target = document.createElement("div");
      target.id = id;
      target.style.display = "contents";
      parent.insertBefore(target, original);
      original.dataset.dashboardOperationalOriginal = id;
      original.style.display = "none";
      return target;
    };

    const mountSlots = () => {
      const primaryGrid = findPrimaryGrid();
      const mainGrid = findFollowingGrid("المؤشرات الرئيسية", ".erp-hero-grid");
      const detailsGrid = findFollowingGrid("تفاصيل الأقسام", ".dash-groups");

      const next: PortalSlots = {
        profitHero: makeSlot(
          findHeroByPrefix(primaryGrid, "صافي الأرباح —"),
          "dashboard-profit-hero-period-slot",
        ),
        submissionCount: makeSlot(
          findHero(mainGrid, "عدد التقديمات"),
          "dashboard-submission-count-period-slot",
        ),
        executionCount: makeSlot(
          findHero(mainGrid, "عدد التنفيذات"),
          "dashboard-execution-count-period-slot",
        ),
        periodSummary: makeSlot(
          findPanel("ملخص اليوم"),
          "dashboard-period-summary-slot",
        ),
        topAgents: makeSlot(
          findPanel("أكثر الوكلاء تحصيلاً"),
          "dashboard-top-agents-period-slot",
        ),
        topCompanies: makeSlot(
          findPanel("أكثر الشركات تقديمًا للخدمات"),
          "dashboard-top-companies-period-slot",
        ),
        serviceDistribution: makeSlot(
          findPanel("عدد التنفيذات المنفذة حسب نوع الخدمة"),
          "dashboard-service-distribution-period-slot",
        ),
        topDestinations: makeSlot(
          findPanel("جهات السفر الأكثر استخدامًا"),
          "dashboard-top-destinations-period-slot",
        ),
        supplierDetails: makeSlot(
          findDetailsCard(detailsGrid, "موردو العملة"),
          "dashboard-supplier-details-period-slot",
        ),
        profitDetails: makeSlot(
          findDetailsCard(detailsGrid, "ملخص الأرباح"),
          "dashboard-profit-details-period-slot",
        ),
      };

      setSlots((previous) => (
        Object.keys(next).every(
          (key) => previous[key as keyof PortalSlots] === next[key as keyof PortalSlots],
        ) ? previous : next
      ));
    };

    mountSlots();
    const observer = new MutationObserver(mountSlots);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>("[data-dashboard-operational-original]").forEach((original) => {
        original.style.removeProperty("display");
        delete original.dataset.dashboardOperationalOriginal;
      });
      for (const id of SLOT_IDS) document.getElementById(id)?.remove();
    };
  }, []);

  const periodLabel = PERIOD_LABELS[period];
  const isLifetime = period === "all";
  const profit = profitQuery.data?.canProfitSummary
    ? profitQuery.data.profitSummary
    : null;

  return (
    <>
      {slots.profitHero && createPortal(
        <DashboardHeroCard
          label={`صافي الأرباح — ${periodLabel}`}
          value={profitQuery.isLoading ? "جاري التحميل..." : fmtDL(profit?.netProfit ?? 0)}
          icon={<TrendingUp size={18} />}
          tone="primary"
          sub="محسوب بأسعار الصرف التاريخية المقفلة"
        />,
        slots.profitHero,
      )}

      {slots.submissionCount && createPortal(
        <DashboardHeroCard
          label={`عدد التقديمات — ${periodLabel}`}
          value={fmtNum(operational.submissionsCount)}
          icon={<ClipboardCheck size={18} />}
          tone="navy"
          sub="حسب تاريخ إنشاء التقديم"
        />,
        slots.submissionCount,
      )}

      {slots.executionCount && createPortal(
        <DashboardHeroCard
          label={`التنفيذات المنفذة — ${periodLabel}`}
          value={fmtNum(operational.executionsCount)}
          icon={<Plane size={18} />}
          tone="primary"
          sub="التنفيذات بحالة منفذ خلال الفترة"
        />,
        slots.executionCount,
      )}

      {slots.periodSummary && createPortal(
        <div className="erp-panel">
          <div className="erp-panel-head">
            <div className="erp-panel-title"><Activity size={14} /> ملخص — {periodLabel}</div>
            <span className="erp-chip">{periodLabel}</span>
          </div>
          <div className="erp-today-grid">
            <PeriodStat label="التنفيذات المنفذة" value={fmtNum(operational.executionsCount)} />
            <PeriodStat label="التقديمات" value={fmtNum(operational.submissionsCount)} />
            <PeriodStat label="خدمات الوكلاء" valueNode={<CurrencyLines map={agentTotals.debit} />} />
            <PeriodStat label="إجمالي التحصيلات" valueNode={<CurrencyLines map={totalCollections} />} tone="green" />
          </div>
        </div>,
        slots.periodSummary,
      )}

      {slots.topAgents && createPortal(
        <AnalyticsPanel title={`أكثر الوكلاء تحصيلاً — ${periodLabel}`} icon={<Users size={14} />} chip="أعلى 5">
          <div className="erp-analytic-table">
            {operational.topAgents.length === 0 && <div className="erp-empty">لا توجد بيانات في الفترة</div>}
            {operational.topAgents.map((agent, index) => (
              <div key={agent.id} className="erp-rank-row">
                <div className="erp-rank-no">{index + 1}</div>
                <div className="erp-rank-body">
                  <div className="erp-rank-name">{agent.name}</div>
                  <div className="erp-rank-sub">{fmtNum(agent.count)} عملية</div>
                </div>
                <div className="erp-rank-value tone-green">{fmtDL(agent.collected)}</div>
              </div>
            ))}
          </div>
        </AnalyticsPanel>,
        slots.topAgents,
      )}

      {slots.topCompanies && createPortal(
        <AnalyticsPanel title={`أكثر الشركات تقديمًا للخدمات — ${periodLabel}`} icon={<Building2 size={14} />} chip="أعلى 5">
          <div className="erp-analytic-table">
            {operational.topCompanies.length === 0 && <div className="erp-empty">لا توجد بيانات في الفترة</div>}
            {operational.topCompanies.map((company, index) => (
              <div key={company.id} className="erp-rank-row">
                <div className="erp-rank-no">{index + 1}</div>
                <div className="erp-rank-body">
                  <div className="erp-rank-name">{company.name}</div>
                  <div className="erp-rank-sub">أكثر خدمة: {company.topService}</div>
                </div>
                <div className="erp-rank-value">{fmtNum(company.count)} طلب</div>
              </div>
            ))}
          </div>
        </AnalyticsPanel>,
        slots.topCompanies,
      )}

      {slots.serviceDistribution && createPortal(
        <AnalyticsPanel
          title={`التنفيذات حسب نوع الخدمة — ${periodLabel}`}
          icon={<Briefcase size={14} />}
          chip={fmtNum(operational.serviceTotal)}
          strongChip
        >
          <div className="erp-donut-wrap">
            <PeriodDonut data={operational.serviceDistribution} total={operational.serviceTotal} />
            <div className="erp-donut-legend">
              {operational.serviceDistribution.map((service, index) => (
                <div key={service.label} className="erp-legend-row">
                  <span className="erp-legend-dot" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                  <span className="erp-legend-label">{service.label}</span>
                  <span className="erp-legend-val">{fmtNum(service.value)} تنفيذ · {service.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </AnalyticsPanel>,
        slots.serviceDistribution,
      )}

      {slots.topDestinations && createPortal(
        <AnalyticsPanel title={`جهات السفر الأكثر استخدامًا — ${periodLabel}`} icon={<Plane size={14} />} chip="أعلى 6">
          <div className="erp-hbar-list">
            {operational.topDestinations.length === 0 && <div className="erp-empty">لا توجد بيانات في الفترة</div>}
            {operational.topDestinations.map((destination) => (
              <div key={destination.name} className="erp-hbar-row">
                <div className="erp-hbar-head">
                  <span className="erp-hbar-name">{destination.name}</span>
                  <span className="erp-hbar-meta">{fmtNum(destination.count)} رحلة · {destination.pct}%</span>
                </div>
                <div className="erp-hbar-track">
                  <div className="erp-hbar-fill" style={{ width: `${Math.max(4, destination.pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </AnalyticsPanel>,
        slots.topDestinations,
      )}

      {slots.supplierDetails && createPortal(
        <DashboardSectionCard title="موردو العملة" icon={<Landmark size={16} />}>
          <DashboardStat label="عدد الموردين" value={fmtNum(supplierTotals.count)} />
          <DashboardStat
            label={isLifetime ? "إجمالي المشتريات" : `المشتريات — ${periodLabel}`}
            valueNode={<CurrencyLines map={supplierTotals.purchases} />}
          />
          <DashboardStat
            label={isLifetime ? "إجمالي المدفوعات" : `المدفوعات — ${periodLabel}`}
            valueNode={<CurrencyLines map={supplierTotals.payments} />}
            tone="green"
          />
          <DashboardStat
            label={isLifetime ? "الرصيد المستحق" : `صافي حركة ${periodLabel}`}
            valueNode={<CurrencyLines map={supplierTotals.due} />}
            tone="red"
            highlight
          />
        </DashboardSectionCard>,
        slots.supplierDetails,
      )}

      {slots.profitDetails && createPortal(
        <DashboardSectionCard title="ملخص الأرباح" icon={<TrendingUp size={16} />}>
          {profitQuery.isLoading ? (
            <DashboardStat label="الحالة" value="جاري تحميل ملخص الفترة..." />
          ) : profit ? (
            <>
              <DashboardStat label={`مبيعات الوكلاء — ${periodLabel}`} value={fmtDL(profit.execSales)} tone="green" />
              <DashboardStat label={`تكلفة الشركات — ${periodLabel}`} value={fmtDL(profit.execCompanyCost)} tone="red" />
              <DashboardStat label={`المصروفات — ${periodLabel}`} value={fmtDL(profit.expenses)} tone="red" />
              <DashboardStat label={`صافي الأرباح — ${periodLabel}`} value={fmtDL(profit.netProfit)} highlight />
            </>
          ) : (
            <DashboardStat label="الحالة" value="تعذر تحميل ملخص الأرباح" />
          )}
        </DashboardSectionCard>,
        slots.profitDetails,
      )}
    </>
  );
}

function DashboardHeroCard({
  label,
  value,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone: "primary" | "navy" | "success" | "warning";
  sub: string;
}) {
  return (
    <div className={`erp-hero erp-hero-${tone}`}>
      <div className="erp-hero-top">
        <span className="erp-hero-label">{label}</span>
        <span className="erp-hero-icon">{icon}</span>
      </div>
      <div className="erp-hero-value" style={{ fontSize: 20, lineHeight: 1.3 }}>{value}</div>
      <div className="erp-hero-foot"><span className="erp-hero-sub">{sub}</span></div>
    </div>
  );
}

function PeriodStat({
  label,
  value,
  valueNode,
  tone,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  tone?: "green";
}) {
  return (
    <div className="erp-today">
      <div className="erp-today-label">{label}</div>
      <div className={`erp-today-value ${tone ? `tone-${tone}` : ""}`} style={{ fontSize: valueNode ? 13 : undefined }}>
        {valueNode ?? value}
      </div>
    </div>
  );
}

function AnalyticsPanel({
  title,
  icon,
  chip,
  strongChip,
  children,
}: {
  title: string;
  icon: ReactNode;
  chip: string;
  strongChip?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="erp-panel">
      <div className="erp-panel-head">
        <div className="erp-panel-title">{icon} {title}</div>
        <span className={`erp-chip ${strongChip ? "erp-chip-strong" : ""}`}>{chip}</span>
      </div>
      {children}
    </div>
  );
}

function DashboardSectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dash-card dash-card-navy">
      <div className="dash-card-header">
        <div className="dash-card-icon">{icon}</div>
        <div className="dash-card-title">{title}</div>
      </div>
      <div className="dash-stats">{children}</div>
    </div>
  );
}

function DashboardStat({
  label,
  value,
  valueNode,
  tone,
  highlight,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  tone?: "green" | "red" | "gold";
  highlight?: boolean;
}) {
  return (
    <div className={`dash-stat ${highlight ? "dash-stat-hl" : ""}`}>
      <div className="dash-stat-label">{label}</div>
      <div className={`dash-stat-value ${tone ? `tone-${tone}` : ""}`}>{valueNode ?? value}</div>
    </div>
  );
}

const DONUT_COLORS = ["#0F1B3D", "#C9A227", "#0EA5E9", "#10B981", "#EF4444", "#8B5CF6", "#F59E0B", "#14B8A6"];

function PeriodDonut({
  data,
  total,
}: {
  data: Array<{ label: string; value: number; pct: number }>;
  total: number;
}) {
  const size = 160;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const sum = data.reduce((result, item) => result + item.value, 0) || 1;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="erp-donut-svg">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={stroke} />
      {data.map((item, index) => {
        const dash = (item.value / sum) * circumference;
        const element = (
          <circle
            key={item.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={DONUT_COLORS[index % DONUT_COLORS.length]}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += dash;
        return element;
      })}
      <text x="50%" y="46%" textAnchor="middle" fontSize="13" fontWeight="700" fill="#64748B">الإجمالي</text>
      <text x="50%" y="60%" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0F172A">{fmtNum(total)}</text>
    </svg>
  );
}
