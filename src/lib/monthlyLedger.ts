/* ============================================================
 *  MONTHLY LEDGER VIEW — عرض كشف الحساب شهرياً مع «رصيد سابق»
 * ============================================================
 *  Pure functions فقط. لا تُنشئ أي سجل في قاعدة البيانات.
 *  صف «رصيد سابق» صف افتراضي (Synthetic) داخل نتيجة العرض فقط.
 *
 *  المصدر: نفس صفوف كشف الحساب الحالية
 *  (`buildAgentLedgerRows` / `buildCompanyLedgerRows`) — لا يُعاد
 *  تعريف أي معادلة محاسبية هنا، ولا يُخلط بين العملات.
 * ============================================================ */

import { cairoToday } from "@/lib/approvalFines";

export type MonthlyPeriod = {
  /** "YYYY-MM" */
  monthKey: string;
  /** بداية أول يوم في الشهر — "YYYY-MM-01" */
  start: string;
  /** آخر يوم معروض (شامل) — "YYYY-MM-DD" */
  endInclusive: string;
  /** بداية اليوم التالي (نصف مفتوح) — "YYYY-MM-DD" */
  endExclusive: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function normalizeLedgerDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** آخر يوم في الشهر "YYYY-MM" */
export function monthLastDay(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m, 0));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** الشهر الحالي بتوقيت النظام (Africa/Cairo). */
export function currentMonthKey(today: string = cairoToday()): string {
  return today.slice(0, 7);
}

/**
 * الفترة المعروضة لشهر معيّن:
 *  - الشهر الحالي: من أول الشهر حتى اليوم (شامل).
 *  - شهر سابق/لاحق: الشهر كاملاً.
 */
export function monthPeriodFor(monthKey: string, today: string = cairoToday()): MonthlyPeriod {
  const key = /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : currentMonthKey(today);
  const start = `${key}-01`;
  const endInclusive = key === today.slice(0, 7) ? today : monthLastDay(key);
  return { monthKey: key, start, endInclusive, endExclusive: addDaysISO(endInclusive, 1) };
}

export function currentMonthPeriod(today: string = cairoToday()): MonthlyPeriod {
  return monthPeriodFor(currentMonthKey(today), today);
}

export type MonthlyLedgerRowBase = {
  id: string;
  date: string;
  currency: string;
  debit: number;
  credit: number;
};

export type OpeningFlag = { isOpeningCarryForward?: boolean };

export type MonthlyLedgerView<T extends MonthlyLedgerRowBase> = {
  period: MonthlyPeriod;
  /** الرصيد السابق لكل عملة (مدين موجب / دائن سالب) */
  openingByCurrency: Record<string, number>;
  /** صفوف «رصيد سابق» الافتراضية */
  openingRows: Array<T & OpeningFlag>;
  /** حركات الشهر فقط (بدون الرصيد السابق) */
  monthlyRows: Array<T & OpeningFlag>;
  /** الرصيد السابق ثم حركات الشهر */
  rowsWithOpening: Array<T & OpeningFlag>;
  monthlyDebitByCurrency: Record<string, number>;
  monthlyCreditByCurrency: Record<string, number>;
  closingBalanceByCurrency: Record<string, number>;
};

export const OPENING_ROW_DESCRIPTION = "رصيد سابق";

/**
 * يبني عرض كشف الحساب الشهري من صفوف الكشف الكاملة.
 *
 *  openingBalance[currency] = Σ(مدين قبل بداية الشهر) − Σ(دائن قبل بداية الشهر)
 *  opening > 0 → عمود المدين، opening < 0 → |القيمة| في عمود الدائن.
 *
 * الحركات الشهرية: start <= date < endExclusive.
 * الصفوف بلا تاريخ تُعامَل كحركات قديمة (تدخل في الرصيد السابق).
 */
export function buildMonthlyLedgerView<T extends MonthlyLedgerRowBase>(args: {
  ledgerRows: ReadonlyArray<T>;
  period: MonthlyPeriod;
  entityId?: string | null;
  /** لبناء الصف الافتراضي بنفس شكل صفوف الكشف */
  makeOpeningRow: (base: {
    id: string;
    date: string;
    currency: string;
    debit: number;
    credit: number;
    description: string;
  }) => T;
}): MonthlyLedgerView<T> {
  const { ledgerRows, period, entityId, makeOpeningRow } = args;
  const rows = Array.isArray(ledgerRows) ? ledgerRows : [];

  const openingByCurrency: Record<string, number> = {};
  const monthlyDebitByCurrency: Record<string, number> = {};
  const monthlyCreditByCurrency: Record<string, number> = {};
  const monthlyRows: Array<T & OpeningFlag> = [];

  for (const r of rows) {
    const cur = (r.currency && String(r.currency)) || "EGP";
    const d = normalizeLedgerDate(r.date);
    const debit = Number(r.debit) || 0;
    const credit = Number(r.credit) || 0;
    if (!d || d < period.start) {
      openingByCurrency[cur] = (openingByCurrency[cur] || 0) + debit - credit;
      continue;
    }
    if (d >= period.endExclusive) continue;
    monthlyDebitByCurrency[cur] = (monthlyDebitByCurrency[cur] || 0) + debit;
    monthlyCreditByCurrency[cur] = (monthlyCreditByCurrency[cur] || 0) + credit;
    monthlyRows.push(r);
  }

  const openingRows: Array<T & OpeningFlag> = Object.keys(openingByCurrency)
    .filter((cur) => Math.abs(openingByCurrency[cur]) > 0.0000001)
    .sort()
    .map((cur) => {
      const net = openingByCurrency[cur];
      const row = makeOpeningRow({
        id: `opening:${entityId || "entity"}:${period.monthKey}:${cur}`,
        date: period.start,
        currency: cur,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        description: OPENING_ROW_DESCRIPTION,
      });
      return { ...row, isOpeningCarryForward: true as const };
    });

  const closingBalanceByCurrency: Record<string, number> = {};
  const currencies = new Set<string>([
    ...Object.keys(openingByCurrency),
    ...Object.keys(monthlyDebitByCurrency),
    ...Object.keys(monthlyCreditByCurrency),
  ]);
  for (const cur of currencies) {
    closingBalanceByCurrency[cur] =
      (openingByCurrency[cur] || 0) +
      (monthlyDebitByCurrency[cur] || 0) -
      (monthlyCreditByCurrency[cur] || 0);
  }

  return {
    period,
    openingByCurrency,
    openingRows,
    monthlyRows,
    rowsWithOpening: [...openingRows, ...monthlyRows],
    monthlyDebitByCurrency,
    monthlyCreditByCurrency,
    closingBalanceByCurrency,
  };
}
