export type SummaryPeriod = "today" | "week" | "month" | "year" | "all";

export const SUMMARY_PERIOD_LABELS: Record<SummaryPeriod, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "الشهر الحالي",
  year: "السنة الحالية",
  all: "إجمالي النظام",
};

/**
 * Converts an ISO date/timestamp (or a display value that begins with one)
 * into YYYY-MM-DD. Invalid and empty values are excluded from dated periods.
 */
export function toSummaryDate(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : null;
}

function shiftSummaryDate(dateISO: string, days: number): string {
  const year = Number(dateISO.slice(0, 4));
  const month = Number(dateISO.slice(5, 7));
  const day = Number(dateISO.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function summaryPeriodStart(period: SummaryPeriod, todayISO: string): string | null {
  const today = toSummaryDate(todayISO);
  if (!today || period === "all") return null;
  if (period === "today") return today;

  if (period === "week") {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const day = Number(today.slice(8, 10));
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return shiftSummaryDate(today, -weekday);
  }

  const year = today.slice(0, 4);
  return period === "year" ? `${year}-01-01` : `${today.slice(0, 7)}-01`;
}

/**
 * Exclusive end boundary, matching the dashboard period selector:
 * - today         → next day
 * - current week  → next Sunday
 * - current month → first day of next month
 * - current year  → first day of next year
 */
export function summaryPeriodEndExclusive(period: SummaryPeriod, todayISO: string): string | null {
  const today = toSummaryDate(todayISO);
  if (!today || period === "all") return null;
  if (period === "today") return shiftSummaryDate(today, 1);

  if (period === "week") {
    const start = summaryPeriodStart(period, todayISO);
    return start ? shiftSummaryDate(start, 7) : null;
  }

  const year = Number(today.slice(0, 4));
  if (period === "year") return `${String(year + 1).padStart(4, "0")}-01-01`;

  const month = Number(today.slice(5, 7));
  if (month === 12) return `${String(year + 1).padStart(4, "0")}-01-01`;
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;
}

/**
 * UI-only date filter for aggregate cards.
 * - today/week/month/year: the complete current calendar period.
 * - all: no filtering at all.
 *
 * This function never writes, moves or recalculates accounting entries.
 */
export function isDateInSummaryPeriod(
  value: string | null | undefined,
  period: SummaryPeriod,
  todayISO: string,
): boolean {
  if (period === "all") return true;
  const date = toSummaryDate(value);
  const start = summaryPeriodStart(period, todayISO);
  const endExclusive = summaryPeriodEndExclusive(period, todayISO);
  if (!date || !start || !endExclusive) return false;
  return date >= start && date < endExclusive;
}

export function summaryPeriodCaption(period: SummaryPeriod): string {
  return `إجماليات ${SUMMARY_PERIOD_LABELS[period]}`;
}
