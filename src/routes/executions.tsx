import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { SummaryPeriodFilter } from "@/components/SummaryPeriodFilter";
import { cairoToday } from "@/lib/approvalFines";
import { parseDisplayDate } from "@/lib/dateFormat";
import { useLive, type Execution } from "@/lib/db";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import { Route as LegacyExecutionsRoute } from "@/features/executions/LegacyExecutionsRoute";

const LegacyExecutionsComponent = (LegacyExecutionsRoute as any).options.component as ComponentType;

export const Route = createFileRoute("/executions")({
  component: ExecutionsRouteWithPeriod,
});

function ExecutionsRouteWithPeriod() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [originalKpiStrip, setOriginalKpiStrip] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let mountedTarget: HTMLElement | null = null;
    let hiddenStrip: HTMLElement | null = null;

    const mountPortal = () => {
      const executionHeading = Array.from(document.querySelectorAll("h1"))
        .find((heading) => heading.textContent?.trim() === "التنفيذ");
      const pageRoot = executionHeading?.closest('div[dir="rtl"]') as HTMLElement | null;
      if (!pageRoot) return false;

      const existingTarget = pageRoot.querySelector<HTMLElement>("#execution-summary-period-portal");
      if (existingTarget) {
        mountedTarget = existingTarget;
        const markedStrip = pageRoot.querySelector<HTMLElement>('[data-execution-original-kpis="true"]');
        hiddenStrip = markedStrip;
        setPortalTarget(existingTarget);
        setOriginalKpiStrip(markedStrip);
        return true;
      }

      const directChildren = Array.from(pageRoot.children) as HTMLElement[];
      const originalStrip = directChildren[1];
      if (!originalStrip) return false;

      const target = document.createElement("div");
      target.id = "execution-summary-period-portal";
      pageRoot.insertBefore(target, originalStrip);

      originalStrip.dataset.executionOriginalKpis = "true";
      originalStrip.style.display = "none";

      mountedTarget = target;
      hiddenStrip = originalStrip;
      setPortalTarget(target);
      setOriginalKpiStrip(originalStrip);
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
      if (hiddenStrip) {
        hiddenStrip.style.removeProperty("display");
        delete hiddenStrip.dataset.executionOriginalKpis;
      }
      mountedTarget?.remove();
    };
  }, []);

  const triggerTodayFilter = () => {
    const todayCard = originalKpiStrip?.children.item(3) as HTMLElement | null;
    todayCard?.click();
  };

  return (
    <>
      <LegacyExecutionsComponent />
      {portalTarget && createPortal(
        <ExecutionSummaryCards onTodayClick={triggerTodayFilter} />,
        portalTarget,
      )}
    </>
  );
}

function ExecutionSummaryCards({ onTodayClick }: { onTodayClick: () => void }) {
  const { rows: executions } = useLive<Execution>("executions");
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>("month");
  const todayISO = cairoToday();

  const summaryExecutions = useMemo(
    () => executions.filter((execution) => {
      const isExecuted = String(execution.operation_status || "").trim() === "منفذ";
      const accountingDate = isExecuted
        ? ((execution as any).financial_posting_date || execution.created_at || null)
        : (execution.created_at || null);
      return isDateInSummaryPeriod(accountingDate, summaryPeriod, todayISO);
    }),
    [executions, summaryPeriod, todayISO],
  );

  const totalCount = summaryExecutions.length;
  const doneCount = summaryExecutions.filter((execution) => execution.operation_status === "منفذ").length;
  const pendingCount = summaryExecutions.filter((execution) => execution.operation_status === "قيد التنفيذ").length;

  const cancelledStatuses = new Set(["ملغي", "ملغية", "ملغى", "محذوف"]);
  const todayCount = executions.filter((execution) => {
    const raw = String((execution as any).travel_date || "").trim();
    if (!raw) return false;
    const iso = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : (parseDisplayDate(raw) || "");
    if (iso !== todayISO) return false;
    return !cancelledStatuses.has(String(execution.operation_status || "").trim());
  }).length;

  return (
    <div style={{ display: "grid", gap: 10, marginBottom: 0 }}>
      <SummaryPeriodFilter value={summaryPeriod} onChange={setSummaryPeriod} />
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <SummaryKpiCard icon="📋" label="إجمالي التنفيذ" value={totalCount} tone="navy" />
        <SummaryKpiCard icon="✅" label="منفذ" value={doneCount} tone="emerald" />
        <SummaryKpiCard icon="⏳" label="قيد التنفيذ" value={pendingCount} tone="sky" />
        <SummaryKpiCard icon="📅" label="تنفيذ اليوم" value={todayCount} tone="amber" onClick={onTodayClick} />
      </div>
    </div>
  );
}

function SummaryKpiCard({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: string;
  label: string;
  value: number;
  tone: "navy" | "emerald" | "sky" | "amber";
  onClick?: () => void;
}) {
  const tones = {
    navy: { bg: "#eef2ff", fg: "#0f1b3d", border: "#dbe3ee" },
    emerald: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },
    sky: { bg: "#f0f9ff", fg: "#0369a1", border: "#bae6fd" },
    amber: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
  } as const;
  const selectedTone = tones[tone];
  const clickable = typeof onClick === "function";

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      } : undefined}
      style={{
        minHeight: 84,
        padding: 14,
        borderRadius: 12,
        background: "#fff",
        border: "1px solid #eef2f7",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 1px 2px rgba(15,23,42,.04)",
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <div style={{
        width: 42,
        height: 42,
        borderRadius: 10,
        background: selectedTone.bg,
        color: selectedTone.fg,
        border: `1px solid ${selectedTone.border}`,
        display: "grid",
        placeItems: "center",
        fontSize: 20,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 18, color: "#0f172a", fontWeight: 800 }}>{value.toLocaleString("ar")}</div>
      </div>
    </div>
  );
}
