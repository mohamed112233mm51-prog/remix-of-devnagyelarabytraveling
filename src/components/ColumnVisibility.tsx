import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3 } from "lucide-react";

export type ColumnDef = { key: string; label: string };

export function sanitizeVisibility(value: unknown, columns: ColumnDef[]): Record<string, boolean> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: Record<string, boolean> = {};
  for (const c of columns) {
    const v = input[c.key];
    out[c.key] = typeof v === "boolean" ? v : true;
  }
  return out;
}

export function ColumnVisibility({
  columns,
  visible,
  onChange,
}: {
  columns: ColumnDef[];
  visible: Record<string, boolean>;
  onChange: (v: Record<string, boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const popW = 240;
      let left = rect.left + window.scrollX - popW + rect.width;
      if (left < 8) left = 8;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
      setPos({ top: rect.bottom + window.scrollY + 4, left });
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      const pop = document.getElementById("__colvis_pop");
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

  const toggle = (key: string) => {
    onChange({ ...visible, [key]: !visible[key] });
  };
  const showAll = () => {
    const next: Record<string, boolean> = {};
    for (const c of columns) next[c.key] = true;
    onChange(next);
  };

  const hiddenCount = columns.filter((c) => visible[c.key] === false).length;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-toolbar"
        onClick={() => setOpen((v) => !v)}
        title="إظهار / إخفاء الأعمدة"
      >
        <Columns3 size={15} />
        <span>الأعمدة{hiddenCount > 0 ? ` (${hiddenCount} مخفي)` : ""}</span>
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          id="__colvis_pop"
          style={{
            position: "absolute", top: pos.top, left: pos.left, width: 240, zIndex: 10050,
            background: "var(--card, #fff)", border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 10,
            fontSize: 12, direction: "rtl",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontWeight: 700, color: "var(--text, #111)" }}>إظهار / إخفاء الأعمدة</span>
            <button type="button" onClick={showAll} style={{ fontSize: 11, border: "none", background: "transparent", color: "var(--primary, #1e3a8a)", cursor: "pointer", padding: 0 }}>إظهار الكل</button>
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {columns.map((c) => (
              <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "3px 4px", borderRadius: 4 }}>
                <input type="checkbox" checked={visible[c.key] !== false} onChange={() => toggle(c.key)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
