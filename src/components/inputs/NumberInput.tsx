import { useEffect, useState, type CSSProperties } from "react";

/**
 * Numeric input that displays empty when the value is 0,
 * and always shows a placeholder "0".
 * - Internal state is the raw string the user typed (so they can clear it).
 * - On blur, an empty string is normalized to 0 (saved value is always numeric).
 * - On focus, a stored 0 is cleared so the user can start typing without
 *   first having to delete the leading zero.
 */
export function NumberInput({
  value,
  onChange,
  placeholder = "0",
  step,
  min,
  max,
  disabled,
  style,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  step?: number | string;
  min?: number;
  max?: number;
  disabled?: boolean;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  // Local text state — keeps user's typing intact (e.g. "12.", "0.0").
  const [text, setText] = useState<string>(() => (value && value !== 0 ? String(value) : ""));

  // Sync from outer changes (form reset / editing). Only update text when the
  // numeric parsing of the current text differs from the incoming value.
  useEffect(() => {
    const parsed = text === "" ? 0 : Number(text);
    if (Number.isNaN(parsed) || parsed !== value) {
      setText(value && value !== 0 ? String(value) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const baseStyle: CSSProperties = {
    height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid #e2e8f0",
    background: disabled ? "#f8fafc" : "#fff", fontSize: 13, color: "#0f172a",
    outline: "none", width: "100%", textAlign: "start",
    ...style,
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      style={baseStyle}
      onFocus={(e) => {
        // Clear a stored 0 on focus so the placeholder shows.
        if (text === "0") {
          setText("");
        }
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // Allow digits, optional minus, single dot
        if (raw === "" || /^-?\d*\.?\d*$/.test(raw)) {
          setText(raw);
          if (raw === "" || raw === "-" || raw === ".") {
            // Don't emit until user typed a parseable value
            return;
          }
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(n);
        }
      }}
      onBlur={() => {
        if (text === "" || text === "-" || text === ".") {
          setText("");
          onChange(0);
          return;
        }
        let n = Number(text);
        if (Number.isNaN(n)) { setText(""); onChange(0); return; }
        if (typeof min === "number" && n < min) n = min;
        if (typeof max === "number" && n > max) n = max;
        // Normalize text representation (drop trailing dots etc.)
        setText(n === 0 ? "" : String(n));
        onChange(n);
      }}
      step={step}
    />
  );
}
