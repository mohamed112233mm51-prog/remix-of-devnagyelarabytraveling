import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Plane, Wallet } from "lucide-react";
import { CurrencyLines } from "@/components/CurrencyLines";
import { SummaryPeriodFilter } from "@/components/SummaryPeriodFilter";
import { Route as LegacyAccountsRoute } from "@/features/accounts/LegacyAccountsRoute";
import { useAgentPeriodTotals } from "@/hooks/useAgentPeriodTotals";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const LegacyAccountsComponent = (LegacyAccountsRoute as any).options.component as ComponentType;

export const Route = createFileRoute("/accounts")({
  component: AccountsRouteWithPeriod,
});

function AccountsRouteWithPeriod() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mountedTarget: HTMLElement | null = null;
    let hiddenSummary: HTMLElement | null = null;

    const mountPortal = () => {
      const heading = Array.from(document.querySelectorAll("h1"))
        .find((node) => node.textContent?.includes("حسابات الوكلاء"));
      const pageRoot = heading?.closest(".accounts-page") as HTMLElement | null;
      if (!pageRoot) return false;

      const existingTarget = pageRoot.querySelector<HTMLElement>("#agent-account-summary-period-portal");
      if (existingTarget) {
        mountedTarget = existingTarget;
        hiddenSummary = pageRoot.querySelector<HTMLElement>('[data-agent-original-summary="true"]');
        setPortalTarget(existingTarget);
        return true;
      }

      const originalSummary = pageRoot.querySelector<HTMLElement>(".account-summary.kpi-rich");
      if (!originalSummary) return false;

      const target = document.createElement("div");
      target.id = "agent-account-summary-period-portal";
      originalSummary.parentElement?.insertBefore(target, originalSummary);

      originalSummary.dataset.agentOriginalSummary = "true";
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
        delete hiddenSummary.dataset.agentOriginalSummary;
      }
      mountedTarget?.remove();
    };
  }, []);

  return (
    <>
      <LegacyAccountsComponent />
      {portalTarget && createPortal(<AgentAccountPeriodSummary />, portalTarget)}
    </>
  );
}

function AgentAccountPeriodSummary() {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const totals = useAgentPeriodTotals(period);

  const debitLabel = period === "month"
    ? "قيمة رحلات الشهر"
    : period === "year"
      ? "قيمة رحلات السنة"
      : "قيمة الرحلات";
  const creditLabel = period === "month"
    ? "مدفوعات الشهر"
    : period === "year"
      ? "مدفوعات السنة"
      : "إجمالي المدفوعات";
  const movementLabel = period === "month"
    ? "صافي حركة الشهر"
    : period === "year"
      ? "صافي حركة السنة"
      : "الصافي المستحق";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SummaryPeriodFilter value={period} onChange={setPeriod} />
      <div className="account-summary kpi-rich">
        <div className="sum-box gold">
          <div className="kpi-icon"><Plane size={18} strokeWidth={2} /></div>
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
