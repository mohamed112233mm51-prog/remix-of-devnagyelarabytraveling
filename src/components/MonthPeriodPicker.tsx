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
    <div className="month-period-picker">
      <label className="month-period-picker__label" htmlFor="month-period-select">الشهر</label>
      <select
        id="month-period-select"
        className="month-select-readable month-period-picker__select"
        value={monthKey}
        onChange={(e) => onChange(e.target.value)}
        aria-label="اختيار شهر كشف الحساب"
        title={monthLabel(monthKey)}
      >
        {options.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
      </select>
      {!isCurrent && (
        <button type="button" className="action-btn month-period-picker__current" onClick={() => onChange(currentMonthKey(today))}>
          الشهر الحالي
        </button>
      )}
      <span className="month-period-picker__range">
        من {period.start} إلى {period.endInclusive}
        {!isCurrent && period.endInclusive !== monthLastDay(monthKey) ? "" : ""}
      </span>
      <style>{`
        .month-period-picker {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          min-width: 0;
        }
        .month-period-picker__label {
          flex: 0 0 auto;
          font-size: 13px;
          font-weight: 700;
          color: var(--muted, #64748b);
          white-space: nowrap;
        }
        .month-period-picker__select {
          flex: 0 1 210px;
          width: 210px;
          min-width: 190px !important;
        }
        .month-period-picker__current {
          flex: 0 0 auto;
          min-height: 40px;
          white-space: nowrap;
        }
        .month-period-picker__range {
          flex: 1 1 220px;
          min-width: 0;
          font-size: 12px;
          line-height: 1.8;
          color: var(--muted, #64748b);
          white-space: normal;
          overflow-wrap: anywhere;
        }
        @media (max-width: 560px) {
          .month-period-picker {
            align-items: stretch;
          }
          .month-period-picker__label {
            width: 100%;
          }
          .month-period-picker__select {
            flex: 1 1 100%;
            width: 100% !important;
            min-width: 0 !important;
          }
          .month-period-picker__current {
            flex: 1 1 auto;
          }
          .month-period-picker__range {
            flex-basis: 100%;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
