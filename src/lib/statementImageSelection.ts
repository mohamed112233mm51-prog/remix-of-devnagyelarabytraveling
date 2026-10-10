import type { StatementExportData } from "./exportStatement";

/** Only additive monetary fields are safe to total. Never add running balances, unit prices or FX rates. */
const ADDITIVE_KEYS = new Set([
  "debit", "credit", "amount", "total", "paid", "net", "sv", "servicevalue",
  "deposit", "withdraw", "withdrawal", "fee", "income", "expense", "expenses",
  "collected", "incoming", "outgoing", "egp", "usd", "bought_amount", "sold_amount",
  "trip_value", "tripvalue", "cost_total", "total_cost", "total_price",
]);

function numericValue(row: Record<string, string | number>, key: string): number | null {
  const raw = row[key + "__excel"] ?? row[key];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !/^-?[0-9]+(?:\\.[0-9]+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Preserve the exact selected rows, but never carry over the totals of the unfiltered report. */
export function selectStatementRows(data: StatementExportData, indices: number[]): StatementExportData {
  const selected = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < data.rows.length).sort((a, b) => a - b);
  const rows = selected.map((i) => data.rows[i]);
  const currencies = new Set(rows.map((r) => String(r.currency ?? r.currency_code ?? "").trim()).filter(Boolean));
  const currency = currencies.size === 1 ? [...currencies][0] : "";
  const summary: NonNullable<StatementExportData["summary"]> = [
    { label: "عدد الصفوف المحددة", value: String(rows.length) },
  ];

  if (rows.length && currencies.size <= 1) {
    for (const c of data.columns) {
      if (!ADDITIVE_KEYS.has(c.key.toLowerCase())) continue;
      const nums = rows.map((r) => numericValue(r, c.key));
      if (nums.some((v) => v === null)) continue;
      const total = (nums as number[]).reduce((a, b) => a + b, 0);
      const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(total);
      summary.push({ label: "إجمالي " + c.header, value: formatted + (currency ? " " + currency : "") });
    }
  }

  return {
    ...data,
    rows,
    summary,
    subtitle: [data.subtitle, "صفوف مختارة من الكشف الأصلي"].filter(Boolean).join(" • "),
    fileName: (data.fileName || data.title) + " - صفوف محددة",
  };
}

export type ImageSelectionRect = { x: number; y: number; w: number; h: number };

export function cropRectToPixels(
  rect: ImageSelectionRect,
  naturalWidth: number,
  naturalHeight: number,
  displayWidth: number,
  displayHeight: number,
): ImageSelectionRect | null {
  if (![rect.x, rect.y, rect.w, rect.h, naturalWidth, naturalHeight, displayWidth, displayHeight].every(Number.isFinite)) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0 || displayWidth <= 0 || displayHeight <= 0 || rect.w <= 0 || rect.h <= 0) return null;
  const x1 = Math.max(0, Math.min(naturalWidth, Math.floor(rect.x / displayWidth * naturalWidth)));
  const y1 = Math.max(0, Math.min(naturalHeight, Math.floor(rect.y / displayHeight * naturalHeight)));
  const x2 = Math.max(0, Math.min(naturalWidth, Math.ceil((rect.x + rect.w) / displayWidth * naturalWidth)));
  const y2 = Math.max(0, Math.min(naturalHeight, Math.ceil((rect.y + rect.h) / displayHeight * naturalHeight)));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
