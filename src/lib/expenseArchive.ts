/** Read-only organization of the original expenses; never persist archive state. */
export type ExpenseArchiveRow = { id: string; date?: string | null; created_at?: string | null };
export type ExpenseArchiveScope = "current" | "archive" | "upcoming" | "undated";

function isoDay(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(text)) return "";
  const day = text.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "";
}

/** Accounting date is authoritative; created_at is only a legacy fallback. */
export function expenseAccountingDay(row: ExpenseArchiveRow): string {
  return isoDay(row.date) || isoDay(row.created_at);
}

export function expenseArchiveMonth(row: ExpenseArchiveRow): string {
  return expenseAccountingDay(row).slice(0, 7);
}

export function buildExpenseArchiveView<T extends ExpenseArchiveRow>(
  expenses: readonly T[], todayISO: string, scope: ExpenseArchiveScope, selectedMonth = "",
) {
  const currentMonth = todayISO.slice(0, 7);
  const groups: Record<ExpenseArchiveScope, T[]> = { current: [], archive: [], upcoming: [], undated: [] };
  for (const row of expenses) {
    const month = expenseArchiveMonth(row);
    const group = !month ? "undated" : month < currentMonth ? "archive" : month > currentMonth ? "upcoming" : "current";
    groups[group].push(row);
  }
  const months = Array.from(new Set(groups.archive.map(expenseArchiveMonth))).sort().reverse();
  const visible = scope === "archive" && selectedMonth
    ? groups.archive.filter(row => expenseArchiveMonth(row) === selectedMonth) : groups[scope];
  return {
    visible, months, currentCount: groups.current.length, archivedCount: groups.archive.length,
    upcomingCount: groups.upcoming.length, undatedCount: groups.undated.length,
  };
}
