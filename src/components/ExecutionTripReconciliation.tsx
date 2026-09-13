import { SearchCheck } from "lucide-react";

/**
 * Lightweight launcher only. The reconciliation workspace lives on its own
 * route so the executions page does not pull SheetJS or reconciliation data
 * into memory before Android opens a native picker.
 */
export function ExecutionTripReconciliation() {
  const openReconciliation = () => {
    if (typeof window === "undefined") return;
    window.location.assign("/execution-trip-reconciliation");
  };

  return (
    <button
      type="button"
      onClick={openReconciliation}
      style={{
        minHeight: 40,
        border: "1px solid #93c5fd",
        borderRadius: 10,
        padding: "9px 14px",
        background: "#eff6ff",
        color: "#0f1b3d",
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
      }}
    >
      <SearchCheck size={17} />
      مطابقة كشف رحلة
    </button>
  );
}
