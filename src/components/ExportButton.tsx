import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  exportStatementToExcel,
  exportStatementToPDF,
  type StatementExportData,
} from "@/lib/exportStatement";

export function ExportButton({ getData, disabled }: { getData: () => StatementExportData; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const popW = 180;
      let left = rect.left + window.scrollX + rect.width - popW;
      if (left < 8) left = 8;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
      setPos({ top: rect.bottom + window.scrollY + 6, left });
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      const pop = document.getElementById("__export_pop");
      if (pop && pop.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
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
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-gold"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        ⬇️ تصدير
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          id="__export_pop"
          style={{
            position: "absolute",
            top: pos.top,
            left: pos.left,
            minWidth: 180,
            zIndex: 10050,
            background: "var(--card, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            overflow: "hidden",
            direction: "rtl",
          }}
        >
          <button type="button" onClick={() => handle("pdf")} style={menuItemStyle}>🧾 PDF</button>
          <button type="button" onClick={() => handle("excel")} style={menuItemStyle}>📊 Excel</button>
        </div>,
        document.body,
      )}
    </>
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
