import { Coins } from "lucide-react";
import { useMemo } from "react";
import { arabicCurrencyName } from "@/lib/exportStatement";

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  minWidth?: number;
  labelText?: string;
  allText?: string;
};

/**
 * Unified currency filter for statement pages.
 * - Renders as an enterprise `.form-group` (label + native select).
 * - Adds a Coins icon in the label.
 * - Sorts options alphabetically by their Arabic name.
 * - Always prepends "كل العملات" as the first option (empty value).
 */
export default function CurrencyFilter({
  value,
  onChange,
  options,
  minWidth = 200,
  labelText = "العملة",
  allText = "كل العملات",
}: Props) {
  const sorted = useMemo(() => {
    const uniq = Array.from(new Set(options.filter(Boolean)));
    return uniq
      .map((code) => ({ code, name: arabicCurrencyName(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [options]);

  return (
    <div className="form-group currency-filter" style={{ minWidth }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Coins size={14} />
        <span>{labelText}</span>
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} dir="rtl">
        <option value="">{allText}</option>
        {sorted.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
