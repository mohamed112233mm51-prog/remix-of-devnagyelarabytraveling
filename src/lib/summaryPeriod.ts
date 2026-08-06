export type SummaryPeriod = "month" | "year" | "all";

export const SUMMARY_PERIOD_LABELS: Record<SummaryPeriod, string> = {
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

export function summaryPeriodStart(period: SummaryPeriod, todayISO: string): string | null {
  const today = toSummaryDate(todayISO);
  if (!today || period === "all") return null;
  const year = today.slice(0, 4);
  return period === "year" ? `${year}-01-01` : `${today.slice(0, 7)}-01`;
}

/**
 * UI-only date filter for aggregate cards.
 * - month/year: from period start through Cairo today, inclusive.
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
  const today = toSummaryDate(todayISO);
  const start = summaryPeriodStart(period, todayISO);
  if (!date || !today || !start) return false;
  return date >= start && date <= today;
}

export function summaryPeriodCaption(period: SummaryPeriod): string {
  return `إجماليات ${SUMMARY_PERIOD_LABELS[period]}`;
}
