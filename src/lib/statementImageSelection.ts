import type { StatementExportData } from "./exportStatement";

/** Select table rows while preserving the original statement's authoritative summary cards. */
export function selectStatementRows(data: StatementExportData, indices: number[]): StatementExportData {
  const selected = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < data.rows.length).sort((a, b) => a - b);
  const rows = selected.map((i) => data.rows[i]);

  return {
    ...data,
    rows,
    subtitle: [data.subtitle, "صفوف مختاره من كشف حساب الوكيل ،الاجماليات تخص كشف حساب الوكيل بالكامل"].filter(Boolean).join(" • "),
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
