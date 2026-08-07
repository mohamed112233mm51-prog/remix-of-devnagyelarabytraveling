import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

/**
 * توحيد قيم الفلاتر النصية متعددة الاختيار دون تعديل البيانات الأصلية.
 * يعالج السجلات القديمة التي تحتوي على مسافات زائدة في بداية/نهاية الاسم
 * أو أكثر من مسافة بين الكلمات.
 */
export function normalizeMultiSelectValue(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

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
      .map(normalizeMultiSelectValue)
      .filter((option) => {
        if (!option || seen.has(option)) return false;
        seen.add(option);
        return true;
      });
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
  return s.selected.includes(normalizeMultiSelectValue(val));
}

export function matchNumeric(val: number, s: ColumnFilterState | undefined): boolean {
  if (!s) return true;
  s = sanitizeColumnFilterState(s);
  if (s.type !== "numeric") return true;
  const parsedA = s.a.trim() === "" ? null : Number(s.a);
  const parsedB = s.b.trim() === "" ? null : Number(s.b);
  const a = parsedA === null || !Number.isFinite(parsedA) ? null : parsedA;
  const b = parsedB === null || !Number.isFinite(parsedB) ? null : parsedB;
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
  state?: ColumnFilterState;
  onChange: (s: ColumnFilterState) => void;
  options?: string[];
};

class ColumnFilterBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[ColumnFilter:${this.props.label}]`, error); }
  render() {
    if (this.state.error) {
      return <span title={`خطأ فلتر ${this.props.label}: ${this.state.error.message}`} style={{ color: "var(--red)", fontSize: 11 }}>⚠</span>;
    }
    return this.props.children;
  }
}

export function ColumnFilter(props: Props) {
  return <ColumnFilterBoundary label={props.label}><ColumnFilterInner {...props} /></ColumnFilterBoundary>;
}

function ColumnFilterInner({ label, state, onChange, options }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const safeState = sanitizeColumnFilterState(state);
  const safeOptions = (() => {
    if (!Array.isArray(options)) return [];
    const seen = new Set<string>();
    return options
      .map(normalizeMultiSelectValue)
      .filter((option) => {
        if (!option || seen.has(option)) return false;
        seen.add(option);
        return true;
      });
  })();
  const active = isFilterActive(safeState);

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
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target)) return;
      const pop = document.getElementById("__colfilter_pop");
      if (pop && pop.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
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
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
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
          <FilterBody state={safeState} onChange={onChange} options={safeOptions} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => onChange(resetFilter(safeState))}
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
  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "4px 6px",
    fontSize: 12,
    border: "1px solid var(--border, #e5e7eb)",
    borderRadius: 4,
    background: "var(--card, #fff)",
    boxSizing: "border-box",
  };

  if (state.type === "text") {
    return <input value={state.value} onChange={(event) => onChange({ type: "text", value: event.target.value })} placeholder="بحث نصي..." style={inputStyle} autoFocus />;
  }
  if (state.type === "dateRange") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>من تاريخ</label>
        <input type="date" value={state.from} onChange={(event) => onChange({ ...state, from: event.target.value })} style={inputStyle} />
        <label style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>إلى تاريخ</label>
        <input type="date" value={state.to} onChange={(event) => onChange({ ...state, to: event.target.value })} style={inputStyle} />
      </div>
    );
  }
  if (state.type === "multiSelect") {
    const opts = options || [];
    const toggle = (value: string) => {
      const normalized = normalizeMultiSelectValue(value);
      const selected = new Set(state.selected.map(normalizeMultiSelectValue));
      if (selected.has(normalized)) selected.delete(normalized);
      else selected.add(normalized);
      onChange({ type: "multiSelect", selected: Array.from(selected) });
    };
    return (
      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, border: "1px solid var(--border, #e5e7eb)", borderRadius: 4, padding: 6 }}>
        {opts.length === 0 && <div style={{ fontSize: 11, color: "var(--muted, #6b7280)" }}>لا توجد قيم</div>}
        {opts.map((option) => (
          <label key={option} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
            <input type="checkbox" checked={state.selected.includes(option)} onChange={() => toggle(option)} />
            <span>{option || "—"}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select value={state.op} onChange={(event) => onChange({ ...state, op: event.target.value as NumericOp })} style={inputStyle}>
        <option value="eq">يساوي</option>
        <option value="gt">أكبر من</option>
        <option value="lt">أقل من</option>
        <option value="between">بين قيمتين</option>
      </select>
      <input type="number" value={state.a} onChange={(event) => onChange({ ...state, a: event.target.value })} placeholder={state.op === "between" ? "من" : "القيمة"} style={inputStyle} />
      {state.op === "between" && (
        <input type="number" value={state.b} onChange={(event) => onChange({ ...state, b: event.target.value })} placeholder="إلى" style={inputStyle} />
      )}
    </div>
  );
}
