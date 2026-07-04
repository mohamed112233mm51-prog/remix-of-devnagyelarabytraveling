import { Coins, ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { arabicCurrencyName } from "@/lib/exportStatement";

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allText?: string;
};

/**
 * Unified currency filter — visually matches ERP toolbar buttons.
 * - 38px height, 9px radius, aligned with `.btn`.
 * - Icon inside the field, native select shows only the currency name.
 * - Custom chevron on the LEFT (RTL).
 * - Options sorted alphabetically by Arabic name, with "كل العملات" first.
 */
export default function CurrencyFilter({
  value,
  onChange,
  options,
  allText = "كل العملات",
}: Props) {
  const sorted = useMemo(() => {
    const uniq = Array.from(new Set(options.filter(Boolean)));
    return uniq
      .map((code) => ({ code, name: arabicCurrencyName(code) || code }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [options]);

  return (
    <div className="currency-filter" dir="rtl">
      <Coins size={15} className="currency-filter__icon" aria-hidden />
      <select
        className="currency-filter__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="فلتر العملة"
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
