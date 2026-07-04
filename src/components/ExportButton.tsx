import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  exportStatementToExcel,
  exportStatementToPDF,
  type StatementExportData,
} from "@/lib/exportStatement";
import { shareStatementViaWhatsApp } from "@/lib/whatsappShare";

type WhatsappProps = {
  /** Phone number to send to (any format — normalized internally). */
  phone?: string | null;
  /** Optional recipient label (unused for now, kept for future). */
  recipientName?: string | null;
};

export function ExportButton({
  getData,
  disabled,
  whatsapp,
}: {
  getData: () => StatementExportData;
  disabled?: boolean;
  whatsapp?: WhatsappProps;
}) {
  const [open, setOpen] = useState<null | "export" | "whatsapp">(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const waRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = (open === "whatsapp" ? waRef.current : btnRef.current);
    const rect = anchor?.getBoundingClientRect();
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
      if (waRef.current?.contains(t)) return;
      const pop = document.getElementById("__export_pop");
      if (pop && pop.contains(t)) return;
      setOpen(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleExport = async (kind: "pdf" | "excel") => {
    setOpen(null);
    const data = getData();
    if (kind === "excel") {
      try { await exportStatementToExcel(data); }
      catch (e) { toast.error("تعذر تصدير ملف Excel: " + (e as Error).message); }
    } else exportStatementToPDF(data);
  };

  const handleWhatsapp = async (kind: "pdf" | "excel") => {
    setOpen(null);
    const data = getData();
    try {
      await shareStatementViaWhatsApp({ kind, data, phone: whatsapp?.phone });
    } catch (e) {
      toast.error("تعذر الإرسال عبر واتساب: " + (e as Error).message);
    }
  };

  return (
    <>
      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button
          ref={btnRef}
          type="button"
          className="btn btn-gold"
          disabled={disabled}
          onClick={() => setOpen((v) => (v === "export" ? null : "export"))}
          style={{
            background: "linear-gradient(180deg, #D4B25A 0%, #B8923A 100%)",
            border: "1px solid #A8822E",
            color: "#1F1A0A",
            fontWeight: 700,
            boxShadow: "0 1px 2px rgba(168,130,46,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
        >
          ⬇️ تصدير
        </button>
        {whatsapp !== undefined && (
          <button
            ref={waRef}
            type="button"
            aria-label="مشاركة عبر واتساب"
            title="مشاركة عبر واتساب"
            disabled={disabled}
            onClick={() => setOpen((v) => (v === "whatsapp" ? null : "whatsapp"))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              background: "#25D366",
              border: "1px solid #1DA851",
              borderRadius: 8,
              color: "#fff",
              cursor: disabled ? "not-allowed" : "pointer",
              boxShadow: "0 1px 2px rgba(29,168,81,0.35)",
              padding: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347zM12.004 2C6.486 2 2.004 6.482 2.004 12c0 1.762.462 3.416 1.268 4.85L2 22l5.286-1.238A9.941 9.941 0 0012.004 22c5.518 0 10-4.482 10-10s-4.482-10-10-10z"/>
            </svg>
          </button>
        )}
      </div>
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
          {open === "export" ? (
            <>
              <button type="button" onClick={() => handleExport("pdf")} style={menuItemStyle}>🧾 PDF</button>
              <button type="button" onClick={() => handleExport("excel")} style={menuItemStyle}>📊 Excel</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => handleWhatsapp("pdf")} style={menuItemStyle}>🧾 إرسال PDF عبر واتساب</button>
              <button type="button" onClick={() => handleWhatsapp("excel")} style={menuItemStyle}>📊 إرسال Excel عبر واتساب</button>
            </>
          )}
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
