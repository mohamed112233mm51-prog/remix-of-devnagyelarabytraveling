import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  exportStatementToExcel,
  exportStatementToPDF,
  type StatementExportData,
} from "@/lib/exportStatement";

export function ExportButton({ getData, disabled }: { getData: () => StatementExportData; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handle = async (kind: "pdf" | "excel") => {
    setOpen(false);
    const data = getData();
    if (kind === "excel") {
      try { await exportStatementToExcel(data); }
      catch (e) { toast.error("تعذر تصدير ملف Excel: " + (e as Error).message); }
    } else exportStatementToPDF(data);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn btn-gold"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        ⬇️ تصدير
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            insetInlineEnd: 0,
            background: "var(--card, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            minWidth: 160,
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => handle("pdf")}
            style={menuItemStyle}
          >
            🧾 PDF
          </button>
          <button
            type="button"
            onClick={() => handle("excel")}
            style={menuItemStyle}
          >
            📊 Excel
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "right",
  padding: "10px 14px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
};
