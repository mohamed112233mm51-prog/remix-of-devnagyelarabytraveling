import { normalizePassengerName } from "./executionTripReconciliation.ts";

export type TripDateInference = {
  column: string;
  date: string;
  dates: string[];
  invalidValues: number;
};

const DATE_HEADER_ALIASES = [
  "تاريخ المغادرة",
  "تاريخ المغادره",
  "تاريخ السفر",
  "موعد السفر",
  "تاريخ الرحلة",
  "تاريخ الرحله",
  "travel date",
  "departure date",
  "date of travel",
  "flight date",
];

function normalizedHeader(value: unknown): string {
  return normalizePassengerName(value).replace(/\s+/g, " ");
}

function westernDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function isoDate(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseManifestTripDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel 1900 date system. Time fractions are intentionally ignored because
    // trip reconciliation is date-scoped, not time-scoped.
    const wholeDays = Math.floor(value);
    if (wholeDays > 0 && wholeDays < 100000) {
      const millis = Date.UTC(1899, 11, 30) + wholeDays * 86400000;
      const date = new Date(millis);
      return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }

  const raw = westernDigits(String(value ?? "").trim());
  if (!raw) return "";

  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // SheetJS commonly formats Excel date cells using the workbook's m/d/yy
  // display format when raw=false (for example the user's real file: 9/1/26).
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (match) return isoDate(2000 + Number(match[3]), Number(match[1]), Number(match[2]));

  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    if (first > 12) return isoDate(year, second, first);
    if (second > 12) return isoDate(year, first, second);
    // Ambiguous 01/09/2026-style values are not guessed. For XLSX files the
    // raw cell value supplied by parseFile resolves the date without ambiguity.
    return "";
  }

  return "";
}

export function detectTripDateColumn(headers: readonly string[]): string {
  const aliases = DATE_HEADER_ALIASES.map(normalizedHeader);
  const exact = headers.find((header) => aliases.includes(normalizedHeader(header)));
  if (exact) return exact;

  return headers.find((header) => {
    const normalized = normalizedHeader(header);
    const hasDate = normalized.includes("تاريخ") || normalized.includes("date");
    const hasTripMeaning =
      normalized.includes("مغادر") ||
      normalized.includes("سفر") ||
      normalized.includes("رحل") ||
      normalized.includes("travel") ||
      normalized.includes("departure") ||
      normalized.includes("flight");
    return hasDate && hasTripMeaning;
  }) || "";
}

export function inferSingleTripDate(
  headers: readonly string[],
  rows: readonly Record<string, unknown>[],
  rawRows?: readonly Record<string, unknown>[],
): TripDateInference {
  const column = detectTripDateColumn(headers);
  if (!column) return { column: "", date: "", dates: [], invalidValues: 0 };

  const dates = new Set<string>();
  let invalidValues = 0;

  rows.forEach((row, index) => {
    const formattedValue = row?.[column];
    const rawValue = rawRows?.[index]?.[column];
    const rawText = String(formattedValue ?? "").trim();
    if (!rawText && (rawValue === null || rawValue === undefined || rawValue === "")) return;

    const parsed = parseManifestTripDate(rawValue ?? formattedValue) || parseManifestTripDate(formattedValue);
    if (parsed) dates.add(parsed);
    else invalidValues += 1;
  });

  const uniqueDates = Array.from(dates).sort();
  return {
    column,
    date: uniqueDates.length === 1 ? uniqueDates[0] : "",
    dates: uniqueDates,
    invalidValues,
  };
}
