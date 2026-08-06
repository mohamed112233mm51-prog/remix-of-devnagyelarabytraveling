import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Briefcase, Wallet } from "lucide-react";
import { CurrencyLines } from "@/components/CurrencyLines";
import { SummaryPeriodFilter } from "@/components/SummaryPeriodFilter";
import { Route as LegacyCompaniesRoute } from "@/features/companies/LegacyCompaniesRoute";
import { useCompanyPeriodTotals } from "@/hooks/useCompanyPeriodTotals";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const LegacyCompaniesComponent = (LegacyCompaniesRoute as any).options.component as ComponentType;

export const Route = createFileRoute("/companies")({
  component: CompaniesRouteWithPeriod,
});

function stretchPortalTarget(target: HTMLElement) {
  target.style.width = "100%";
  target.style.minWidth = "0";
  target.style.maxWidth = "none";
  target.style.gridColumn = "1 / -1";
  target.style.flex = "1 1 100%";
  target.style.alignSelf = "stretch";
}

function CompaniesRouteWithPeriod() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mountedTarget: HTMLElement | null = null;
    let hiddenSummary: HTMLElement | null = null;

    const mountPortal = () => {
      const heading = Array.from(document.querySelectorAll("h1"))
        .find((node) => node.textContent?.includes("حسابات الشركات الصادرة"));
      const pageRoot = heading?.closest(".accounts-page") as HTMLElement | null;
      if (!pageRoot) return false;

      const existingTarget = pageRoot.querySelector<HTMLElement>("#company-account-summary-period-portal");
      if (existingTarget) {
        stretchPortalTarget(existingTarget);
        mountedTarget = existingTarget;
        hiddenSummary = pageRoot.querySelector<HTMLElement>('[data-company-original-summary="true"]');
        setPortalTarget(existingTarget);
        return true;
      }

      const originalSummary = pageRoot.querySelector<HTMLElement>(".account-summary.kpi-rich");
      if (!originalSummary) return false;

      const target = document.createElement("div");
      target.id = "company-account-summary-period-portal";
      stretchPortalTarget(target);
      originalSummary.parentElement?.insertBefore(target, originalSummary);

      originalSummary.dataset.companyOriginalSummary = "true";
      originalSummary.style.display = "none";

      mountedTarget = target;
      hiddenSummary = originalSummary;
      setPortalTarget(target);
      return true;
    };

    if (!mountPortal()) {
      observer = new MutationObserver(() => {
        if (mountPortal()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      if (hiddenSummary) {
        hiddenSummary.style.removeProperty("display");
        delete hiddenSummary.dataset.companyOriginalSummary;
      }
      mountedTarget?.remove();
    };
  }, []);

  return (
    <>
      <LegacyCompaniesComponent />
      {portalTarget && createPortal(<CompanyAccountPeriodSummary />, portalTarget)}
    </>
  );
}

function CompanyAccountPeriodSummary() {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const totals = useCompanyPeriodTotals(period);

  const debitLabel = period === "month"
    ? "خدمات الشهر"
    : period === "year"
      ? "خدمات السنة"
      : "إجمالي الخدمات";
  const creditLabel = period === "month"
    ? "مدفوعات الشهر"
    : period === "year"
      ? "مدفوعات السنة"
      : "إجمالي المدفوع";
  const movementLabel = period === "month"
    ? "صافي حركة الشهر"
    : period === "year"
      ? "صافي حركة السنة"
      : "المتبقي للشركات";

  return (
    <div style={{ display: "grid", gap: 10, width: "100%", minWidth: 0, gridColumn: "1 / -1" }}>
      <SummaryPeriodFilter value={period} onChange={setPeriod} />
      <div className="account-summary kpi-rich" style={{ width: "100%", minWidth: 0 }}>
        <div className="sum-box gold">
          <div className="kpi-icon"><Briefcase size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">{debitLabel}</div>
            <div className="val"><CurrencyLines map={totals.debit} /></div>
          </div>
        </div>
        <div className="sum-box green">
          <div className="kpi-icon"><Wallet size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">{creditLabel}</div>
            <div className="val"><CurrencyLines map={totals.credit} /></div>
          </div>
        </div>
        <div className="sum-box red">
          <div className="kpi-icon"><AlertCircle size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">{movementLabel}</div>
            <div className="val"><CurrencyLines map={totals.movement} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
