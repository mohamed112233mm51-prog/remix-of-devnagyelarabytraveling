import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Receipt, TrendingDown, Wallet } from "lucide-react";
import { SummaryPeriodFilter } from "@/components/SummaryPeriodFilter";
import { Route as LegacyExpensesRoute } from "@/features/expenses/LegacyExpensesRoute";
import { useExpensePeriodTotals } from "@/hooks/useExpensePeriodTotals";
import { fmtDL } from "@/lib/db";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const LegacyExpensesComponent = (LegacyExpensesRoute as any).options.component as ComponentType;

export const Route = createFileRoute("/expenses")({
  component: ExpensesRouteWithPeriod,
});

function ExpensesRouteWithPeriod() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mountedTarget: HTMLElement | null = null;
    let hiddenSummary: HTMLElement | null = null;

    const mountPortal = () => {
      const heading = Array.from(document.querySelectorAll("h1"))
        .find((node) => node.textContent?.includes("إدارة المصروفات"));
      const pageRoot = heading?.closest(".accounts-page") as HTMLElement | null;
      if (!pageRoot) return false;

      const existingTarget = pageRoot.querySelector<HTMLElement>("#expense-summary-period-portal");
      if (existingTarget) {
        mountedTarget = existingTarget;
        hiddenSummary = pageRoot.querySelector<HTMLElement>('[data-expense-original-summary="true"]');
        setPortalTarget(existingTarget);
        return true;
      }

      const originalSummary = pageRoot.querySelector<HTMLElement>(".account-summary");
      if (!originalSummary) return false;

      const target = document.createElement("div");
      target.id = "expense-summary-period-portal";
      originalSummary.parentElement?.insertBefore(target, originalSummary);

      originalSummary.dataset.expenseOriginalSummary = "true";
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
        delete hiddenSummary.dataset.expenseOriginalSummary;
      }
      mountedTarget?.remove();
    };
  }, []);

  return (
    <>
      <LegacyExpensesComponent />
      {portalTarget && createPortal(<ExpensePeriodSummary />, portalTarget)}
    </>
  );
}

function ExpensePeriodSummary() {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const totals = useExpensePeriodTotals(period);
  const suffix = period === "month" ? " الشهر" : period === "year" ? " السنة" : "";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SummaryPeriodFilter value={period} onChange={setPeriod} />
      <div className="account-summary">
        <div className="sum-box red">
          <span className="kpi-icon"><TrendingDown size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">إجمالي مصروفات{suffix}</div>
            <div className="val">{fmtDL(totals.total)}</div>
          </div>
        </div>
        <div className="sum-box gold">
          <span className="kpi-icon"><Wallet size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">المصروفات الثابتة{suffix}</div>
            <div className="val">{fmtDL(totals.fixed)}</div>
          </div>
        </div>
        <div className="sum-box green">
          <span className="kpi-icon"><Receipt size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">المصروفات المتغيرة{suffix}</div>
            <div className="val">{fmtDL(totals.variable)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
