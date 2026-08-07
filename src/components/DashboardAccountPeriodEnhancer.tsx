import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Building2, HandCoins, Users, Wallet } from "lucide-react";
import { CurrencyLines } from "@/components/CurrencyLines";
import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";
import { useAgentPeriodTotals } from "@/hooks/useAgentPeriodTotals";
import { useCompanyPeriodTotals } from "@/hooks/useCompanyPeriodTotals";
import { useExpensePeriodTotals } from "@/hooks/useExpensePeriodTotals";
import { useMerchantPeriodTotals } from "@/hooks/useMerchantPeriodTotals";
import { fmtDL, fmtNum, useLive, type IssuingCompany, type Merchant } from "@/lib/db";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const DASHBOARD_PERIOD_BY_LABEL: Record<string, SummaryPeriod> = {
  اليوم: "today",
  "هذا الأسبوع": "week",
  "هذا الشهر": "month",
  "السنة الحالية": "year",
  "إجمالي النظام": "all",
};

const DASHBOARD_PERIOD_LABELS: Record<SummaryPeriod, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
  year: "السنة الحالية",
  all: "إجمالي النظام",
};

type PortalSlots = {
  expenseHero: HTMLElement | null;
  agentSales: HTMLElement | null;
  companyMovement: HTMLElement | null;
  agentPayments: HTMLElement | null;
  merchantCollections: HTMLElement | null;
  merchantBalance: HTMLElement | null;
  agentDetails: HTMLElement | null;
  companyDetails: HTMLElement | null;
  merchantDetails: HTMLElement | null;
  expenseDetails: HTMLElement | null;
};

const EMPTY_SLOTS: PortalSlots = {
  expenseHero: null,
  agentSales: null,
  companyMovement: null,
  agentPayments: null,
  merchantCollections: null,
  merchantBalance: null,
  agentDetails: null,
  companyDetails: null,
  merchantDetails: null,
  expenseDetails: null,
};

const SLOT_IDS = [
  "dashboard-expense-hero-period-slot",
  "dashboard-agent-sales-period-slot",
  "dashboard-company-movement-period-slot",
  "dashboard-agent-payments-period-slot",
  "dashboard-merchant-collections-period-slot",
  "dashboard-merchant-balance-period-slot",
  "dashboard-agent-details-period-slot",
  "dashboard-company-details-period-slot",
  "dashboard-merchant-details-period-slot",
  "dashboard-expense-details-period-slot",
];

/**
 * يُركَّب مرة واحدة داخل Root، ولا يشغّل اشتراكات الحسابات إلا عندما تكون
 * صفحة الداشبورد موجودة فعلياً في DOM.
 */
export function DashboardAccountPeriodEnhancer() {
  const [dashboardMounted, setDashboardMounted] = useState(false);

  useEffect(() => {
    const sync = () => setDashboardMounted(Boolean(document.querySelector(".erp-period-bar")));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return dashboardMounted ? <DashboardAccountPeriodPortals /> : null;
}

function DashboardAccountPeriodPortals() {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const [slots, setSlots] = useState<PortalSlots>(EMPTY_SLOTS);

  const agentTotals = useAgentPeriodTotals(period);
  const companyTotals = useCompanyPeriodTotals(period);
  const merchantTotals = useMerchantPeriodTotals(period);
  const expenseTotals = useExpensePeriodTotals(period);
  const agentAccountTotals = useAgentAccountTotals();

  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: merchants } = useLive<Merchant>("merchants");

  // نفس مصادر العدد المستخدمة في الداشبورد الأصلي وبنفس fmtNum.
  const activeCompanyCount = useMemo(
    () => companies.filter((company) => ((company as any).status || "نشط") === "نشط").length,
    [companies],
  );
  const activeMerchantCount = useMemo(
    () => merchants.filter((merchant) => ((merchant as any).status || "نشط") === "نشط").length,
    [merchants],
  );

  useEffect(() => {
    const periodBar = document.querySelector<HTMLElement>(".erp-period-bar");
    if (!periodBar) return;

    const syncPeriod = () => {
      const activeButton = periodBar.querySelector<HTMLElement>(".erp-period-tab.is-active");
      const label = activeButton?.textContent?.trim() || "";
      const next = DASHBOARD_PERIOD_BY_LABEL[label];
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
    const findFollowingGrid = (sectionTitle: string, gridSelector: string): HTMLElement | null => {
      const title = Array.from(document.querySelectorAll<HTMLElement>(".erp-section-title"))
        .find((node) => node.textContent?.trim() === sectionTitle);
      let sibling = title?.nextElementSibling as HTMLElement | null;
      while (sibling) {
        if (sibling.matches(gridSelector)) return sibling;
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

    const findHeroCard = (grid: HTMLElement | null, label: string): HTMLElement | null => {
      if (!grid) return null;
      return Array.from(grid.querySelectorAll<HTMLElement>(":scope > .erp-hero"))
        .find((card) => card.querySelector<HTMLElement>(".erp-hero-label")?.textContent?.trim() === label) || null;
    };

    const findHeroCardByPrefix = (grid: HTMLElement | null, prefix: string): HTMLElement | null => {
      if (!grid) return null;
      return Array.from(grid.querySelectorAll<HTMLElement>(":scope > .erp-hero"))
        .find((card) => card.querySelector<HTMLElement>(".erp-hero-label")?.textContent?.trim().startsWith(prefix)) || null;
    };

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
        original.dataset.dashboardPeriodOriginal = id;
        original.style.display = "none";
        return existing;
      }

      const target = document.createElement("div");
      target.id = id;
      target.style.display = "contents";
      parent.insertBefore(target, original);
      original.dataset.dashboardPeriodOriginal = id;
      original.style.display = "none";
      return target;
    };

    const mountSlots = () => {
      const primaryGrid = findPrimaryGrid();
      const mainGrid = findFollowingGrid("المؤشرات الرئيسية", ".erp-hero-grid");
      const detailsGrid = findFollowingGrid("تفاصيل الأقسام", ".dash-groups");

      const next: PortalSlots = {
        expenseHero: makeSlot(
          findHeroCardByPrefix(primaryGrid, "المصروفات —"),
          "dashboard-expense-hero-period-slot",
        ),
        agentSales: makeSlot(
          findHeroCard(mainGrid, "إجمالي مبيعات الوكلاء"),
          "dashboard-agent-sales-period-slot",
        ),
        companyMovement: makeSlot(
          findHeroCard(mainGrid, "إجمالي مستحقات الشركات الصادرة"),
          "dashboard-company-movement-period-slot",
        ),
        agentPayments: makeSlot(
          findHeroCard(mainGrid, "إجمالي تحصيلات الوكلاء"),
          "dashboard-agent-payments-period-slot",
        ),
        merchantCollections: makeSlot(
          findHeroCard(mainGrid, "إجمالي تحصيلات تجار الكاش"),
          "dashboard-merchant-collections-period-slot",
        ),
        merchantBalance: makeSlot(
          findHeroCard(mainGrid, "رصيد تجار الكاش"),
          "dashboard-merchant-balance-period-slot",
        ),
        agentDetails: makeSlot(
          findDetailsCard(detailsGrid, "الوكلاء"),
          "dashboard-agent-details-period-slot",
        ),
        companyDetails: makeSlot(
          findDetailsCard(detailsGrid, "الشركات الصادرة"),
          "dashboard-company-details-period-slot",
        ),
        merchantDetails: makeSlot(
          findDetailsCard(detailsGrid, "تاجر الكاش"),
          "dashboard-merchant-details-period-slot",
        ),
        expenseDetails: makeSlot(
          findDetailsCard(detailsGrid, "المصروفات"),
          "dashboard-expense-details-period-slot",
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
      document.querySelectorAll<HTMLElement>("[data-dashboard-period-original]").forEach((original) => {
        original.style.removeProperty("display");
        delete original.dataset.dashboardPeriodOriginal;
      });
      for (const id of SLOT_IDS) document.getElementById(id)?.remove();
    };
  }, []);

  const periodLabel = DASHBOARD_PERIOD_LABELS[period];
  const isLifetime = period === "all";

  const agentMovementLabel = isLifetime ? "المستحق" : `صافي حركة ${periodLabel}`;
  const companyMovementLabel = isLifetime ? "المتبقي" : `صافي حركة ${periodLabel}`;
  const servicesLabel = isLifetime ? "قيمة الخدمات" : `خدمات ${periodLabel}`;
  const paymentsLabel = isLifetime ? "إجمالي المدفوعات" : `مدفوعات ${periodLabel}`;
  const companyServicesLabel = isLifetime ? "إجمالي الخدمات" : `خدمات ${periodLabel}`;
  const merchantBalanceLabel = isLifetime ? "رصيد تاجر الكاش" : `صافي حركة ${periodLabel}`;

  return (
    <>
      {slots.expenseHero && createPortal(
        <DashboardHeroCard
          label={`المصروفات — ${periodLabel}`}
          value={fmtDL(expenseTotals.total)}
          icon={<Wallet size={18} />}
          tone="warning"
          sub="من سجل المصروفات حسب تاريخ الحركة"
        />,
        slots.expenseHero,
      )}

      {slots.agentSales && createPortal(
        <DashboardHeroCard
          label={isLifetime ? "إجمالي مبيعات الوكلاء" : `خدمات الوكلاء — ${periodLabel}`}
          value={<CurrencyLines map={agentTotals.debit} />}
          icon={<Users size={18} />}
          tone="success"
          sub={isLifetime ? "إجمالي دفتر حسابات الوكلاء" : "حركة الفترة المختارة"}
        />,
        slots.agentSales,
      )}

      {slots.companyMovement && createPortal(
        <DashboardHeroCard
          label={isLifetime ? "إجمالي مستحقات الشركات الصادرة" : `صافي حركة الشركات — ${periodLabel}`}
          value={<CurrencyLines map={companyTotals.movement} />}
          icon={<Building2 size={18} />}
          tone="warning"
          sub={isLifetime ? "إجمالي دفتر حسابات الشركات" : "الخدمات ناقص المدفوعات خلال الفترة"}
        />,
        slots.companyMovement,
      )}

      {slots.agentPayments && createPortal(
        <DashboardHeroCard
          label={isLifetime ? "إجمالي تحصيلات الوكلاء" : `مدفوعات الوكلاء — ${periodLabel}`}
          value={<CurrencyLines map={agentTotals.credit} />}
          icon={<HandCoins size={18} />}
          tone="success"
          sub="من نفس حركات كشف حساب الوكلاء"
        />,
        slots.agentPayments,
      )}

      {slots.merchantCollections && createPortal(
        <DashboardHeroCard
          label={isLifetime ? "إجمالي تحصيلات تجار الكاش" : `تحصيلات تجار الكاش — ${periodLabel}`}
          value={<CurrencyLines map={merchantTotals.totalCollected} />}
          icon={<HandCoins size={18} />}
          tone="navy"
          sub="من نفس حركات كشف حساب تاجر الكاش"
        />,
        slots.merchantCollections,
      )}

      {slots.merchantBalance && createPortal(
        <DashboardHeroCard
          label={isLifetime ? "رصيد تجار الكاش" : `صافي حركة تجار الكاش — ${periodLabel}`}
          value={<CurrencyLines map={merchantTotals.balance} />}
          icon={<Wallet size={18} />}
          tone="navy"
          sub={isLifetime ? "إجمالي الرصيد الحالي لكل عملة" : "صافي تأثير حركات الفترة"}
        />,
        slots.merchantBalance,
      )}

      {slots.agentDetails && createPortal(
        <DashboardSectionCard title="الوكلاء" icon={<Users size={16} />}>
          <DashboardStat label="عدد الوكلاء" value={fmtNum(agentAccountTotals.agentCount)} />
          <DashboardStat label={servicesLabel} valueNode={<CurrencyLines map={agentTotals.debit} />} />
          <DashboardStat label={paymentsLabel} valueNode={<CurrencyLines map={agentTotals.credit} />} tone="green" />
          <DashboardStat label={agentMovementLabel} valueNode={<CurrencyLines map={agentTotals.movement} />} tone="red" highlight />
        </DashboardSectionCard>,
        slots.agentDetails,
      )}

      {slots.companyDetails && createPortal(
        <DashboardSectionCard title="الشركات الصادرة" icon={<Building2 size={16} />}>
          <DashboardStat label="عدد الشركات" value={fmtNum(activeCompanyCount)} />
          <DashboardStat label={companyServicesLabel} valueNode={<CurrencyLines map={companyTotals.debit} />} />
          <DashboardStat label={paymentsLabel} valueNode={<CurrencyLines map={companyTotals.credit} />} tone="green" />
          <DashboardStat label={companyMovementLabel} valueNode={<CurrencyLines map={companyTotals.movement} />} tone="red" highlight />
        </DashboardSectionCard>,
        slots.companyDetails,
      )}

      {slots.merchantDetails && createPortal(
        <DashboardSectionCard title="تاجر الكاش" icon={<HandCoins size={16} />}>
          <DashboardStat label="عدد التجار" value={fmtNum(activeMerchantCount)} />
          <DashboardStat label={isLifetime ? "الوارد (صافي)" : `الوارد — ${periodLabel}`} valueNode={<CurrencyLines map={merchantTotals.totalIncoming} />} tone="green" />
          <DashboardStat label={isLifetime ? "الصادر" : `الصادر — ${periodLabel}`} valueNode={<CurrencyLines map={merchantTotals.totalOutgoing} />} tone="red" />
          <DashboardStat label="نسبة التاجر 1%" valueNode={<CurrencyLines map={merchantTotals.totalCommission} />} />
          <DashboardStat label={merchantBalanceLabel} valueNode={<CurrencyLines map={merchantTotals.balance} />} highlight />
        </DashboardSectionCard>,
        slots.merchantDetails,
      )}

      {slots.expenseDetails && createPortal(
        <DashboardSectionCard title="المصروفات" icon={<Wallet size={16} />}>
          <DashboardStat label={isLifetime ? "الإجمالي" : `إجمالي ${periodLabel}`} value={fmtDL(expenseTotals.total)} tone="red" />
          <DashboardStat label={isLifetime ? "ثابتة" : `ثابتة — ${periodLabel}`} value={fmtDL(expenseTotals.fixed)} />
          <DashboardStat label={isLifetime ? "متغيرة" : `متغيرة — ${periodLabel}`} value={fmtDL(expenseTotals.variable)} />
        </DashboardSectionCard>,
        slots.expenseDetails,
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
  tone: "success" | "warning" | "navy" | "primary";
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
