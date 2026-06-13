import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X, Search } from "lucide-react";

export type SearchableSelectOption = { value: string; label: string };

/**
 * Enterprise-grade searchable dropdown (combobox).
 * - Type to filter options.
 * - Click an option or press Enter to select.
 * - Keyboard: ↑/↓ navigate, Enter select, Esc close.
 * - Renders the menu via a portal so it never gets clipped by modals/cards.
 * Compatible with the existing inline-style ERP forms.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "— اختر —",
  disabled,
  allowClear = true,
  style,
  emptyLabel = "لا توجد نتائج",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchableSelectOption[] | readonly string[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  style?: CSSProperties;
  emptyLabel?: string;
}) {
  const normalized: SearchableSelectOption[] = useMemo(() => {
    const arr = Array.isArray(options) ? options : [];
    const seen = new Set<string>();
    const out: SearchableSelectOption[] = [];
    for (const o of arr) {
      const opt: SearchableSelectOption = typeof o === "string" ? { value: o, label: o } : o;
      if (!opt || !opt.value || seen.has(opt.value)) continue;
      seen.add(opt.value);
      out.push(opt);
    }
    return out;
  }, [options]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const selectedLabel = normalized.find((o) => o.value === value)?.label || "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [normalized, query]);

  useEffect(() => { setActive(0); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      const menu = document.getElementById("searchable-select-menu");
      if (menu && menu.contains(t)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect();
        setRect({ top: r.bottom + 4, left: r.left, width: r.width });
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    onScrollOrResize();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[active];
      if (o) pick(o.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const baseStyle: CSSProperties = {
    height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#fff", fontSize: 13, color: "#0f172a",
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 8, cursor: disabled ? "not-allowed" : "pointer", userSelect: "none",
    ...style,
  };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={openMenu}
        style={baseStyle}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selectedLabel ? "#0f172a" : "#94a3b8" }}>
          {selectedLabel || placeholder}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {allowClear && value && !disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              aria-label="مسح"
              style={{ background: "transparent", border: 0, padding: 2, cursor: "pointer", color: "#94a3b8", display: "inline-flex" }}
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown size={16} color="#94a3b8" />
        </span>
      </div>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          id="searchable-select-menu"
          style={{
            position: "fixed", top: rect.top, left: rect.left, width: rect.width,
            zIndex: 100001, background: "#fff", border: "1px solid #e2e8f0",
            borderRadius: 10, boxShadow: "0 12px 32px rgba(15,23,42,.18)",
            overflow: "hidden", display: "flex", flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
            <Search size={14} color="#94a3b8" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="بحث..."
              style={{ flex: 1, border: 0, outline: "none", fontSize: 13, background: "transparent", color: "#0f172a" }}
            />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 14, textAlign: "center", color: "#94a3b8", fontSize: 12.5 }}>{emptyLabel}</div>
            ) : filtered.map((o, i) => (
              <div
                key={o.value}
                onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: "8px 12px", fontSize: 13, cursor: "pointer",
                  background: i === active ? "#eff6ff" : (o.value === value ? "#f8fafc" : "#fff"),
                  color: "#0f172a", fontWeight: o.value === value ? 700 : 400,
                  borderInlineStart: o.value === value ? "3px solid #1e3a8a" : "3px solid transparent",
                }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
