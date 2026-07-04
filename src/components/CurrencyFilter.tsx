import { Coins, ChevronDown } from "lucide-react";
import { useId, useMemo } from "react";
import { arabicCurrencyName } from "@/lib/exportStatement";

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labelText?: string;
  allText?: string;
};

/**
 * Unified currency filter — visually matches ERP buttons/inputs.
 * - Fixed height 38px, radius 9px, aligned with `.btn` and other toolbar controls.
 * - Icon + inline label + native <select> with a custom chevron on the LEFT (RTL).
 * - Options sorted alphabetically by Arabic name, with "كل العملات" first.
 */
export default function CurrencyFilter({
  value,
  onChange,
  options,
  labelText = "العملة",
  allText = "كل العملات",
}: Props) {
  const id = useId();
  const sorted = useMemo(() => {
    const uniq = Array.from(new Set(options.filter(Boolean)));
    return uniq
      .map((code) => ({ code, name: arabicCurrencyName(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [options]);

  return (
    <div className="currency-filter" dir="rtl">
      <Coins size={15} className="currency-filter__icon" aria-hidden />
      <label htmlFor={id} className="currency-filter__label">{labelText}:</label>
      <select
        id={id}
        className="currency-filter__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{allText}</option>
        {sorted.map((o) => (
          <option key={o.code} value={o.code}>{o.name}</option>
        ))}
      </select>
      <ChevronDown size={14} className="currency-filter__chevron" aria-hidden />
    </div>
  );
}
