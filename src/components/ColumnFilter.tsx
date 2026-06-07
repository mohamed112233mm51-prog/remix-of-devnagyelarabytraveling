import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";

export type NumericOp = "eq" | "gt" | "lt" | "between";

export type ColumnFilterState =
  | { type: "text"; value: string }
  | { type: "dateRange"; from: string; to: string }
  | { type: "multiSelect"; selected: string[] }
  | { type: "numeric"; op: NumericOp; a: string; b: string };

export const emptyText = (): ColumnFilterState => ({ type: "text", value: "" });
export const emptyDateRange = (): ColumnFilterState => ({ type: "dateRange", from: "", to: "" });
export const emptyMultiSelect = (): ColumnFilterState => ({ type: "multiSelect", selected: [] });
export const emptyNumeric = (): ColumnFilterState => ({ type: "numeric", op: "eq", a: "", b: "" });

export function sanitizeColumnFilterState(value: unknown, fallback: ColumnFilterState = emptyText()): ColumnFilterState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const state = value as Partial<ColumnFilterState> & Record<string, unknown>;
  if (state.type === "text") return { type: "text", value: typeof state.value === "string" ? state.value : "" };
  if (state.type === "dateRange") {
    return {
      type: "dateRange",
      from: typeof state.from === "string" ? state.from : "",
      to: typeof state.to === "string" ? state.to : "",
    };
  }
  if (state.type === "multiSelect") {
    const seen = new Set<string>();
    const selected = (Array.isArray(state.selected) ? state.selected : [])
      .map((v) => String(v ?? "").trim())
      .filter((v) => v && !seen.has(v) && seen.add(v));
    return { type: "multiSelect", selected };
  }
  if (state.type === "numeric") {
    const op = state.op === "gt" || state.op === "lt" || state.op === "between" ? state.op : "eq";
    return {
      type: "numeric",
      op,
      a: typeof state.a === "string" || typeof state.a === "number" ? String(state.a) : "",
      b: typeof state.b === "string" || typeof state.b === "number" ? String(state.b) : "",
    };
  }
  return fallback;
}

export function sanitizeFilterMap<T extends Record<string, ColumnFilterState>>(value: unknown, defaults: T): T {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const next: Record<string, ColumnFilterState> = {};
  for (const key of Object.keys(defaults)) {
    next[key] = sanitizeColumnFilterState(input[key], defaults[key]);
  }
  return next as T;
}

export function isFilterActive(s: ColumnFilterState | undefined): boolean {
  if (!s) return false;
  s = sanitizeColumnFilterState(s);
  if (s.type === "text") return s.value.trim() !== "";
  if (s.type === "dateRange") return !!(s.from || s.to);
  if (s.type === "multiSelect") return s.selected.length > 0;
  if (s.type === "numeric") return s.a.trim() !== "" || (s.op === "between" && s.b.trim() !== "");
  return false;
}

export function matchText(val: string, s: ColumnFilterState | undefined): boolean {
  if (!s) return true;
  s = sanitizeColumnFilterState(s);
  if (s.type !== "text" || !s.value.trim()) return true;
  return String(val || "").toLowerCase().includes(s.value.trim().toLowerCase());
}

export function matchDateRange(val: string, s: ColumnFilterState | undefined): boolean {
  if (!s) return true;
  s = sanitizeColumnFilterState(s);
  if (s.type !== "dateRange") return true;
  const current = String(val || "");
  if (s.from && current < s.from) return false;
  if (s.to && current > s.to) return false;
  return true;
}

export function matchMultiSelect(val: string, s: ColumnFilterState | undefined): boolean {
  if (!s) return true;
  s = sanitizeColumnFilterState(s);
  if (s.type !== "multiSelect" || s.selected.length === 0) return true;
  return s.selected.includes(String(val || ""));
}

export function matchNumeric(val: number, s: ColumnFilterState | undefined): boolean {
  if (!s) return true;
  s = sanitizeColumnFilterState(s);
  if (s.type !== "numeric") return true;
  const a = s.a.trim() === "" ? null : Number(s.a);
  const b = s.b.trim() === "" ? null : Number(s.b);
  const n = Number(val || 0);
  if (s.op === "eq") return a === null || Math.round(n) === Math.round(a);
  if (s.op === "gt") return a === null || n > a;
  if (s.op === "lt") return a === null || n < a;
  if (s.op === "between") {
    if (a !== null && n < a) return false;
    if (b !== null && n > b) return false;
    return true;
  }
  return true;
}

type Props = {
  label: string;
  state: ColumnFilterState;
  onChange: (s: ColumnFilterState) => void;
  options?: string[]; // for multiSelect
};

export function ColumnFilter({ label, state, onChange, options }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const active = isFilterActive(state);

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
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const pop = document.getElementById("__colfilter_pop");
      if (pop && pop.contains(target)) return;
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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={`فلتر: ${label}`}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 20, height: 20, marginInlineStart: 4, border: "none",
          background: active ? "var(--primary, #1e3a8a)" : "transparent",
          color: active ? "#fff" : "var(--muted, #6b7280)",
          borderRadius: 4, cursor: "pointer", padding: 0, verticalAlign: "middle",
        }}
      >
        <Filter size={12} strokeWidth={2.4} />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          id="__colfilter_pop"
          style={{
            position: "absolute", top: pos.top, left: pos.left, width: 240, zIndex: 10050,
            background: "var(--card, #fff)", border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 10,
            fontSize: 12, direction: "rtl",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--text, #111)" }}>{label}</div>
          <FilterBody state={state} onChange={onChange} options={options} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => { onChange(resetFilter(state)); }}
              style={{ flex: 1, padding: "4px 8px", fontSize: 11, border: "1px solid var(--border, #e5e7eb)", background: "transparent", borderRadius: 4, cursor: "pointer" }}
            >مسح</button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ flex: 1, padding: "4px 8px", fontSize: 11, border: "none", background: "var(--primary, #1e3a8a)", color: "#fff", borderRadius: 4, cursor: "pointer" }}
            >تم</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function resetFilter(s: ColumnFilterState): ColumnFilterState {
  if (s.type === "text") return emptyText();
  if (s.type === "dateRange") return emptyDateRange();
  if (s.type === "multiSelect") return emptyMultiSelect();
  return emptyNumeric();
}

function FilterBody({ state, onChange, options }: { state: ColumnFilterState; onChange: (s: ColumnFilterState) => void; options?: string[] }) {
  const inputStyle: React.CSSProperties = { width: "100%", padding: "4px 6px", fontSize: 12, border: "1px solid var(--border, #e5e7eb)", borderRadius: 4, background: "var(--card, #fff)", boxSizing: "border-box" };

  if (state.type === "text") {
    return <input value={state.value} onChange={(e) => onChange({ type: "text", value: e.target.value })} placeholder="بحث نصي..." style={inputStyle} autoFocus />;
  }
  if (state.type === "dateRange") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>من تاريخ</label>
        <input type="date" value={state.from} onChange={(e) => onChange({ ...state, from: e.target.value })} style={inputStyle} />
        <label style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>إلى تاريخ</label>
        <input type="date" value={state.to} onChange={(e) => onChange({ ...state, to: e.target.value })} style={inputStyle} />
      </div>
    );
  }
  if (state.type === "multiSelect") {
    const opts = options || [];
    const toggle = (v: string) => {
      const set = new Set(state.selected);
      if (set.has(v)) set.delete(v); else set.add(v);
      onChange({ type: "multiSelect", selected: Array.from(set) });
    };
    return (
      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, border: "1px solid var(--border, #e5e7eb)", borderRadius: 4, padding: 6 }}>
        {opts.length === 0 && <div style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>لا توجد قيم</div>}
        {opts.map((v) => (
          <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
            <input type="checkbox" checked={state.selected.includes(v)} onChange={() => toggle(v)} />
            <span>{v || "—"}</span>
          </label>
        ))}
      </div>
    );
  }
  // numeric
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select value={state.op} onChange={(e) => onChange({ ...state, op: e.target.value as NumericOp })} style={inputStyle}>
        <option value="eq">يساوي</option>
        <option value="gt">أكبر من</option>
        <option value="lt">أقل من</option>
        <option value="between">بين قيمتين</option>
      </select>
      <input type="number" value={state.a} onChange={(e) => onChange({ ...state, a: e.target.value })} placeholder={state.op === "between" ? "من" : "القيمة"} style={inputStyle} />
      {state.op === "between" && (
        <input type="number" value={state.b} onChange={(e) => onChange({ ...state, b: e.target.value })} placeholder="إلى" style={inputStyle} />
      )}
    </div>
  );
}
