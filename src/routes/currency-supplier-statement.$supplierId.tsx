import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { CurrencyTotalsCards } from "@/components/CurrencyTotalsCards";
import { SummaryPeriodFilter } from "@/components/SummaryPeriodFilter";
import { Route as LegacyCurrencySupplierStatementRoute } from "@/features/currency-suppliers/LegacyCurrencySupplierStatementRoute";
import { useCurrencySupplierPeriodTotals } from "@/hooks/useCurrencySupplierPeriodTotals";
import { type SummaryPeriod } from "@/lib/summaryPeriod";

const LegacyCurrencySupplierStatementComponent = (
  LegacyCurrencySupplierStatementRoute as any
).options.component as ComponentType;

export const Route = createFileRoute("/currency-supplier-statement/$supplierId")({
  component: CurrencySupplierStatementRouteWithPeriod,
});

function CurrencySupplierStatementRouteWithPeriod() {
  const { supplierId } = Route.useParams();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mountedTarget: HTMLElement | null = null;
    const hiddenCards = new Set<HTMLElement>();

    const hideLegacyCards = (pageRoot: HTMLElement, target: HTMLElement) => {
      for (const child of Array.from(pageRoot.children)) {
        const element = child as HTMLElement;
        if (element === target) continue;
        const isCurrencyCards = element.getAttribute("dir") === "rtl"
          && element.style.display === "grid"
          && element.style.gridTemplateColumns.includes("260px");
        if (!isCurrencyCards) continue;
        element.dataset.currencySupplierOriginalSummary = "true";
        element.style.display = "none";
        hiddenCards.add(element);
      }
    };

    const mountPortal = () => {
      const heading = Array.from(document.querySelectorAll("h1"))
        .find((node) => node.textContent?.includes("كشف حساب:"));
      const pageRoot = heading?.closest(".accounts-page") as HTMLElement | null;
      const pageHead = heading?.closest(".page-head") as HTMLElement | null;
      if (!pageRoot || !pageHead) return false;

      let target = pageRoot.querySelector<HTMLElement>("#currency-supplier-summary-period-portal");
      if (!target) {
        target = document.createElement("div");
        target.id = "currency-supplier-summary-period-portal";
        pageHead.insertAdjacentElement("afterend", target);
      }

      mountedTarget = target;
      hideLegacyCards(pageRoot, target);
      setPortalTarget(target);

      observer?.disconnect();
      observer = new MutationObserver(() => hideLegacyCards(pageRoot, target!));
      observer.observe(pageRoot, { childList: true });
      return true;
    };

    observer = new MutationObserver(() => mountPortal());
    observer.observe(document.body, { childList: true, subtree: true });
    mountPortal();

    return () => {
      observer?.disconnect();
      for (const element of hiddenCards) {
        element.style.removeProperty("display");
        delete element.dataset.currencySupplierOriginalSummary;
      }
      mountedTarget?.remove();
    };
  }, []);

  return (
    <>
      <LegacyCurrencySupplierStatementComponent />
      {portalTarget && createPortal(
        <CurrencySupplierPeriodSummary supplierId={supplierId} />,
        portalTarget,
      )}
    </>
  );
}

function CurrencySupplierPeriodSummary({ supplierId }: { supplierId: string }) {
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const { totals, loading } = useCurrencySupplierPeriodTotals(supplierId, period);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SummaryPeriodFilter value={period} onChange={setPeriod} />
      {loading ? (
        <div className="card" style={{ padding: 14, color: "var(--muted-foreground, #64748b)", fontSize: 12 }}>
          جارٍ حساب إجماليات الفترة...
        </div>
      ) : (
        <CurrencyTotalsCards
          totals={totals}
          entityKind="currency_supplier"
          movementMode={period !== "all"}
        />
      )}
    </div>
  );
}
