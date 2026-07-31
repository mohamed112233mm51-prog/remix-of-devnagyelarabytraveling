import { currentMonthKey, monthLastDay, type MonthlyPeriod } from "@/lib/monthlyLedger";

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
}

/** خيارات الشهور: من أقدم تاريخ متاح حتى الشهر الحالي (الأحدث أولاً). */
export function buildMonthOptions(dates: ReadonlyArray<string>, today: string): string[] {
  const current = currentMonthKey(today);
  const keys = new Set<string>([current]);
  for (const d of dates) {
    const k = String(d || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(k)) keys.add(k);
  }
  return Array.from(keys).sort().reverse();
}

export function MonthPeriodPicker({
  monthKey, onChange, options, period, today,
}: {
  monthKey: string;
  onChange: (k: string) => void;
  options: string[];
  period: MonthlyPeriod;
  today: string;
}) {
  const isCurrent = monthKey === currentMonthKey(today);
  return (
    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>الشهر</label>
      <select value={monthKey} onChange={(e) => onChange(e.target.value)} style={{ height: 34 }}>
        {options.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
      </select>
      {!isCurrent && (
        <button type="button" className="action-btn" onClick={() => onChange(currentMonthKey(today))}>الشهر الحالي</button>
      )}
      <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
        من {period.start} إلى {period.endInclusive}
        {!isCurrent && period.endInclusive !== monthLastDay(monthKey) ? "" : ""}
      </span>
    </div>
  );
}
