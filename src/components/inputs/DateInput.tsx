import { useEffect, useState, type CSSProperties } from "react";
import { toDisplayDate, parseDisplayDate, isValidDisplayDate } from "@/lib/dateFormat";

/**
 * Date input that displays DD/MM/YYYY and stores ISO YYYY-MM-DD.
 * - `value` is ISO ("YYYY-MM-DD") or "" / null / undefined.
 * - `onChange` emits ISO or "" (never undefined).
 * - When `defaultToday` is true and the field is empty on mount,
 *   it auto-fills with today (also emits onChange).
 */
export function DateInput({
  value,
  onChange,
  defaultToday = false,
  disabled,
  style,
  placeholder = "DD/MM/YYYY",
  ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (iso: string) => void;
  defaultToday?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState<string>(() => toDisplayDate(value || "") || "");

  // Auto-fill today on mount when requested and value is empty.
  useEffect(() => {
    if (defaultToday && !value) {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      setText(toDisplayDate(iso));
      onChange(iso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync from outer value updates (resets, editing).
  useEffect(() => {
    const incoming = toDisplayDate(value || "") || "";
    if (incoming !== text) setText(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const baseStyle: CSSProperties = {
    height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#fff", fontSize: 13, color: "#0f172a",
    outline: "none", width: "100%",
    ...style,
  };

  const formatTyping = (raw: string) => {
    // Keep only digits and slashes, auto-insert slashes.
    const digits = raw.replace(/[^\d]/g, "").slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return out;
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={10}
      aria-label={ariaLabel}
      style={baseStyle}
      onChange={(e) => {
        const v = formatTyping(e.target.value);
        setText(v);
        if (v === "") { onChange(""); return; }
        if (isValidDisplayDate(v)) {
          const iso = parseDisplayDate(v);
          if (iso) onChange(iso);
        }
      }}
      onBlur={() => {
        if (text === "") { onChange(""); return; }
        if (!isValidDisplayDate(text)) {
          // Revert to last known good value
          setText(toDisplayDate(value || "") || "");
        }
      }}
    />
  );
}
