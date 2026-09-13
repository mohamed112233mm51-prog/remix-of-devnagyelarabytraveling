import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ExecutionTripReconciliationWorkspace } from "@/components/ExecutionTripReconciliationWorkspace";
import { usePerm } from "@/hooks/usePerm";

export const Route = createFileRoute("/execution-trip-reconciliation")({
  component: ExecutionTripReconciliationRoute,
});

function ExecutionTripReconciliationRoute() {
  const perm = usePerm("executions");

  const backToExecutions = () => {
    if (typeof window !== "undefined") window.location.assign("/executions");
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    const title = document.querySelector<HTMLElement>(".page-title");
    if (!title) return;
    const previous = title.innerHTML;
    title.innerHTML = "قائمة <span>التنفيذ</span>";
    return () => {
      title.innerHTML = previous;
    };
  }, []);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "calc(100vh - 120px)",
        display: "grid",
        alignContent: "start",
        gap: 16,
        padding: "12px 0 28px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#0f1b3d", fontWeight: 900 }}>مطابقة كشف رحلة</h1>
        </div>
        <button
          type="button"
          onClick={backToExecutions}
          style={{
            minHeight: 40,
            border: "1px solid #dbe3ee",
            borderRadius: 10,
            padding: "9px 14px",
            background: "#fff",
            color: "#0f1b3d",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          العودة للتنفيذات
        </button>
      </div>

      {!perm.edit ? (
        <div style={{ padding: 12, borderRadius: 10, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", fontSize: 12.5, fontWeight: 800 }}>
          مطابقة الكشف وتنفيذ المطابقين تحتاج صلاحية تعديل في قسم التنفيذات.
        </div>
      ) : (
        <ExecutionTripReconciliationWorkspace onExit={backToExecutions} />
      )}
    </div>
  );
}
