import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowUpFromLine,
  Banknote,
  Wallet,
} from "lucide-react";
import { CurrencyLines } from "@/components/CurrencyLines";
import { SummaryPeriodFilter } from "@/components/SummaryPeriodFilter";
import { Route as LegacyMerchantsRoute } from "@/features/merchants/LegacyMerchantsRoute";
import { useMerchantPeriodTotals } from "@/hooks/useMerchantPeriodTotals";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const LegacyMerchantsComponent = (LegacyMerchantsRoute as any).options.component as ComponentType;

export const Route = createFileRoute("/merchants")({
  component: MerchantsRouteWithPeriod,
});

function MerchantsRouteWithPeriod() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mountedTarget: HTMLElement | null = null;
    let hiddenSummary: HTMLElement | null = null;

    const mountPortal = () => {
      const heading = Array.from(document.querySelectorAll("h1"))
        .find((node) => node.textContent?.includes("حسابات تاجر الكاش"));
      const pageRoot = heading?.closest(".accounts-page") as HTMLElement | null;
      if (!pageRoot) return false;

      const existingTarget = pageRoot.querySelector<HTMLElement>("#merchant-summary-period-portal");
      if (existingTarget) {
        mountedTarget = existingTarget;
        hiddenSummary = pageRoot.querySelector<HTMLElement>('[data-merchant-original-summary="true"]');
        setPortalTarget(existingTarget);
        return true;
      }

      const originalSummary = pageRoot.querySelector<HTMLElement>(".account-summary.kpi-rich.kpi-merchants");
      if (!originalSummary) return false;

      const target = document.createElement("div");
      target.id = "merchant-summary-period-portal";
      originalSummary.parentElement?.insertBefore(target, originalSummary);

      originalSummary.dataset.merchantOriginalSummary = "true";
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
        delete hiddenSummary.dataset.merchantOriginalSummary;
      }
      mountedTarget?.remove();
    };
  }, []);

  return (
    <>
      <LegacyMerchantsComponent />
      {portalTarget && createPortal(<MerchantPeriodSummary />, portalTarget)}
    </>
  );
}

function MerchantPeriodSummary() {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const totals = useMerchantPeriodTotals(period);

  const suffix = period === "month" ? " خلال الشهر" : period === "year" ? " خلال السنة" : "";
  const balanceLabel = period === "month"
    ? "صافي حركة الشهر"
    : period === "year"
      ? "صافي حركة السنة"
      : "رصيد تاجر الكاش";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SummaryPeriodFilter value={period} onChange={setPeriod} />
      <div className="account-summary kpi-rich kpi-merchants">
        <div className="sum-box green">
          <span className="kpi-icon"><ArrowDownCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">تاجر الكاش الوارد من الوكلاء{suffix}</div>
            <div className="val"><CurrencyLines map={totals.totalIncoming} /></div>
          </div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">تاجر الكاش الصادر للشركات{suffix}</div>
            <div className="val"><CurrencyLines map={totals.totalOutgoing} /></div>
          </div>
        </div>
        <div className="sum-box gold">
          <span className="kpi-icon"><Banknote size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">النقدية المحصلة من التجار{suffix}</div>
            <div className="val"><CurrencyLines map={totals.totalCollected} /></div>
          </div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpFromLine size={20} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">النقدية المصروفة للتجار{suffix}</div>
            <div className="val"><CurrencyLines map={totals.totalPaidOut} /></div>
          </div>
        </div>
        <div className="sum-box hero">
          <span className="kpi-icon"><Wallet size={22} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">{balanceLabel}</div>
            <div className="val"><CurrencyLines map={totals.balance} /></div>
            <div className="kpi-sub">
              {period === "all"
                ? "الرصيد الحالي بعد كل الحركات — كل عملة على حدة"
                : "حركة الفترة المختارة فقط — لا تغيّر الرصيد التراكمي"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
