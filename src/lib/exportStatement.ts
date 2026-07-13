import ExcelJS from "exceljs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadBranding, DEFAULT_COMPANY_NAME } from "./branding";

export type StatementColumn = { header: string; key: string };
export type StatementSummary = { label: string; value: string };

export type StatementExportData = {
  title: string;
  subtitle?: string;
  summary?: StatementSummary[];
  columns: StatementColumn[];
  rows: Record<string, string | number>[];
  fileName?: string;
};

const COMPANY_NAME = DEFAULT_COMPANY_NAME;

const CURRENCY_AR_NAMES: Record<string, string> = {
  EGP: "الجنيه المصري",
  USD: "الدولار الأمريكي",
  LYD: "الدينار الليبي",
  SAR: "الريال السعودي",
  AED: "الدرهم الإماراتي",
  EUR: "اليورو",
  GBP: "الجنيه الإسترليني",
};
export const arabicCurrencyName = (code?: string | null) =>
  code ? (CURRENCY_AR_NAMES[code.toUpperCase()] || code) : "";

/**
 * Build a unified Arabic file name for statement exports.
 * Example: buildArabicFileName("كشف حساب الوكيل", "أحمد محمد", "USD")
 *   -> "كشف حساب الوكيل أحمد محمد (الدولار الأمريكي)"
 */
export function buildArabicFileName(kind: string, entityName?: string | null, currency?: string | null): string {
  const parts: string[] = [kind.trim()];
  const name = (entityName || "").trim();
  if (name) parts.push(name);
  const cur = arabicCurrencyName(currency || "");
  if (cur) parts.push(cur);
  return parts.join(" - ").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
}

function dataUrlToExcelImage(dataUrl: string): { base64: string; ext: "png" | "jpeg" | "gif" } | null {
  if (!dataUrl || !dataUrl.startsWith("data:")) return null;
  const m = /^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const ext = m[1].toLowerCase() === "jpg" ? "jpeg" : (m[1].toLowerCase() as "png" | "jpeg" | "gif");
  return { base64: m[2], ext };
}
const CURRENCY = "ج.م";

// ---------- helpers ----------
// Currency / monetary columns
const CURRENCY_KEYWORDS = [
  "amount", "price", "total", "paid", "remaining", "balance", "due",
  "value", "cost", "fee", "credit", "debit", "net", "subtotal", "discount",
  "سعر", "إجمالي", "اجمالي", "مدفوع", "متبقي", "رصيد", "مبلغ", "قيمة",
  "صافي", "خصم", "الصافي", "المتبقي", "المدفوع", "الإجمالي", "الاجمالي",
  "قيمة الرحلة",
];

// Plain numeric (count/quantity) columns — NO currency suffix
const QUANTITY_KEYWORDS = [
  "count", "qty", "quantity", "pax", "passengers", "seats", "nights", "rooms",
  "العدد", "عدد", "كمية", "المسافرين", "الركاب", "الليالي", "الغرف",
];

const matchesAny = (k: string, list: string[]) =>
  list.some((w) => k.includes(w.toLowerCase()));

type ColType = "currency" | "quantity" | "text";
const detectColType = (key: string, header: string): ColType => {
  const k = (key + " " + header).toLowerCase();
  // Quantity wins over currency to avoid "العدد" being treated as money
  if (matchesAny(k, QUANTITY_KEYWORDS.map((w) => w.toLowerCase()))) return "quantity";
  if (matchesAny(k, CURRENCY_KEYWORDS.map((w) => w.toLowerCase()))) return "currency";
  return "text";
};

const parseNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const excelKey = (key: string) => `${key}__excel`;
const uiKey = (key: string) => `${key}__ui`;
const getExcelCellValue = (row: Record<string, string | number>, key: string) =>
  row[excelKey(key)] ?? row[key];

// PDF cell value: mirror the on-screen cell, but if the UI hides a non-zero
// value (e.g. shows "—" for negatives via a `> 0 ? fmt : "—"` guard) fall
// back to the raw __excel numeric so negative amounts still print.
const NUMERIC_KEYWORDS = [...CURRENCY_KEYWORDS, ...QUANTITY_KEYWORDS].map((w) => w.toLowerCase());
const pdfCellValue = (row: Record<string, string | number>, key: string): string | number => {
  const ui = row[key];
  const raw = row[excelKey(key)];
  const rawNum = typeof raw === "number" ? raw : (typeof raw === "string" ? parseNumber(raw) : null);
  const uiStr = ui === undefined || ui === null ? "" : String(ui);
  const uiIsEmpty = uiStr === "" || uiStr === "—" || uiStr === "-";
  if (rawNum !== null && rawNum !== 0 && uiIsEmpty) {
    const k = key.toLowerCase();
    const isNumeric = NUMERIC_KEYWORDS.some((w) => k.includes(w));
    if (isNumeric) {
      const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, useGrouping: true }).format(rawNum);
      return formatted;
    }
    return rawNum;
  }
  return ui === undefined || ui === null ? "" : ui;
};

function debugStatementExportValues(data: StatementExportData) {
  const priceCol = data.columns.find((c) => /price|السعر/i.test(`${c.key} ${c.header}`));
  const shouldDebug = /كشف حساب|فودافون كاش/.test(data.title) && (priceCol || data.rows.length > 0);
  if (!shouldDebug) return;
  const priceKey = priceCol?.key || "price";
  console.table(data.rows.map((row) => ({
    "passenger/service/date": [row.service, row.type, row.name, row.date].filter(Boolean).join(" / ") || row.n || "—",
    uiDisplayedPrice: row[uiKey(priceKey)] ?? row[priceKey] ?? "—",
    excelExportedPrice: getExcelCellValue(row, priceKey) ?? "—",
    trip_value: getExcelCellValue(row, "tv") ?? getExcelCellValue(row, "total") ?? getExcelCellValue(row, "trip_value") ?? "—",
    count: getExcelCellValue(row, "count") ?? "—",
    raw_price: row.raw_price ?? row[excelKey("raw_price")] ?? row[excelKey(priceKey)] ?? row[priceKey] ?? "—",
  })));
}

const todayLabel = () => {
  const d = new Date();
  const date = d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  return `${date} - ${time}`;
};

async function getCurrentUserLabel(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    const u: any = data.session?.user;
    if (!u) return "—";
    if (u.id) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name,email")
        .eq("id", u.id)
        .maybeSingle();
      const p: any = prof;
      if (p?.full_name) return p.full_name;
      if (p?.email) return p.email;
    }
    return u.email || "—";
  } catch {
    return "—";
  }
}

// ---------- Excel ----------
export async function buildStatementExcelBlob(data: StatementExportData): Promise<{ blob: Blob; fileName: string }> {
  const { blob, fileName } = await _buildExcel(data);
  return { blob, fileName };
}

export async function exportStatementToExcel(data: StatementExportData) {
  const { blob, fileName } = await _buildExcel(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function _buildExcel(data: StatementExportData): Promise<{ blob: Blob; fileName: string }> {
  debugStatementExportValues(data);

  const branding = await loadBranding();
  const companyName = branding.companyName || COMPANY_NAME;

  const wb = new ExcelJS.Workbook();
  wb.creator = companyName;
  wb.created = new Date();

  const ws = wb.addWorksheet("التقرير", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 0 }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    properties: { defaultRowHeight: 20 },
  });

  const colCount = data.columns.length;
  const lastColLetter = colLetter(colCount);
  const hexToArgb = (hex: string) => {
    const m = /^#?([a-f\d]{6})$/i.exec((hex || "").trim());
    return m ? `FF${m[1].toUpperCase()}` : "FF0F1B3D";
  };
  const PRIMARY_ARGB = hexToArgb(branding.primaryColor);
  const SECONDARY_ARGB = hexToArgb(branding.secondaryColor);

  // ===== BRAND BAND (logo + company name) =====
  ws.mergeCells(`A1:${lastColLetter}1`);
  const r1 = ws.getCell("A1");
  r1.value = `        ${companyName}`;
  r1.font = { name: "Cairo", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  r1.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
  r1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY_ARGB } };
  ws.getRow(1).height = 56;

  // Embed logo image (if available)
  const img = dataUrlToExcelImage(branding.logoDataUrl);
  if (img) {
    try {
      const imageId = wb.addImage({ base64: img.base64, extension: img.ext });
      // Anchor to top-right area of the band (row 1)
      ws.addImage(imageId, {
        tl: { col: 0.15, row: 0.15 },
        ext: { width: 60, height: 60 },
        editAs: "oneCell",
      });
    } catch { /* ignore */ }
  }

  // Row 2: report title
  ws.mergeCells(`A2:${lastColLetter}2`);
  const r2 = ws.getCell("A2");
  r2.value = data.title;
  r2.font = { name: "Cairo", size: 14, bold: true, color: { argb: SECONDARY_ARGB } };
  r2.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
  r2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  ws.getRow(2).height = 26;

  // Row 3: subtitle / meta line (export date + user)
  const metaRow = 3;
  ws.mergeCells(`A${metaRow}:${lastColLetter}${metaRow}`);
  const r3 = ws.getCell(`A${metaRow}`);
  const subtitleBit = data.subtitle ? `${data.subtitle}  •  ` : "";
  r3.value = `${subtitleBit}تاريخ التصدير: ${todayLabel()}`;
  r3.font = { name: "Cairo", size: 10, color: { argb: "FF475569" } };
  r3.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl", wrapText: true };
  r3.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  ws.getRow(metaRow).height = 22;

  let nextRow = 4;

  // ===== SUMMARY BOX =====
  if (data.summary && data.summary.length) {
    // Spacer
    ws.getRow(nextRow).height = 6;
    nextRow++;

    // Summary title
    ws.mergeCells(`A${nextRow}:${lastColLetter}${nextRow}`);
    const sTitle = ws.getCell(`A${nextRow}`);
    sTitle.value = "ملخص التقرير";
    sTitle.font = { name: "Cairo", size: 12, bold: true, color: { argb: "FF1E293B" } };
    sTitle.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
    sTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
    sTitle.border = thinBorder("FFC7D2FE");
    ws.getRow(nextRow).height = 22;
    nextRow++;

    for (const s of data.summary) {
      // Each summary row: label spans first half, value spans second half
      const splitAt = Math.max(1, Math.floor(colCount / 2));
      const labelEnd = colLetter(splitAt);
      const valStart = colLetter(splitAt + 1);
      ws.mergeCells(`A${nextRow}:${labelEnd}${nextRow}`);
      ws.mergeCells(`${valStart}${nextRow}:${lastColLetter}${nextRow}`);

      const labelCell = ws.getCell(`A${nextRow}`);
      const valueCell = ws.getCell(`${valStart}${nextRow}`);

      const isRemaining = /متبقي|due|remaining/i.test(s.label);
      labelCell.value = s.label;
      labelCell.font = { name: "Cairo", size: 11, bold: true, color: { argb: "FF334155" } };
      labelCell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      labelCell.border = thinBorder("FFE2E8F0");

      valueCell.value = s.value;
      valueCell.font = {
        name: "Cairo",
        size: 11,
        bold: true,
        color: { argb: isRemaining ? "FFB91C1C" : "FF0F172A" },
      };
      valueCell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
      valueCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isRemaining ? "FFFEF2F2" : "FFFFFFFF" },
      };
      valueCell.border = thinBorder("FFE2E8F0");
      ws.getRow(nextRow).height = 20;
      nextRow++;
    }

    ws.getRow(nextRow).height = 6;
    nextRow++;
  }

  // ===== TABLE HEADER =====
  const headerRowIdx = nextRow;
  const headerRow = ws.getRow(headerRowIdx);
  data.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Cairo", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PRIMARY_ARGB } };
    cell.border = thinBorder(SECONDARY_ARGB);
  });
  headerRow.height = 26;

  // ===== DATA ROWS =====
  const colTypes: ColType[] = data.columns.map((c) => detectColType(c.key, c.header));

  data.rows.forEach((row, rIdx) => {
    const excelRow = ws.getRow(headerRowIdx + 1 + rIdx);
    data.columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = getExcelCellValue(row, c.key);
      const type = colTypes[i];
      const num = type !== "text" ? parseNumber(raw) : null;

      if (num !== null && type === "currency") {
        cell.value = num;
        cell.numFmt = `#,##0.00 "${CURRENCY}";[Red]-#,##0.00 "${CURRENCY}";"-"`;
        cell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
      } else if (num !== null && type === "quantity") {
        cell.value = num;
        cell.numFmt = Number.isInteger(num) ? `#,##0;[Red]-#,##0;"-"` : `#,##0.##;[Red]-#,##0.##;"-"`;
        cell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
      } else {
        cell.value = raw === undefined || raw === null || raw === "" ? "—" : (raw as string | number);
        cell.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl", wrapText: true };
      }

      cell.font = { name: "Cairo", size: 10, color: { argb: "FF1F2937" } };
      cell.border = thinBorder("FFE5E7EB");

      // Zebra rows
      if (rIdx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    });
    excelRow.height = 20;
  });

  // ===== Column widths (auto) =====
  data.columns.forEach((c, i) => {
    const colIdx = i + 1;
    let max = String(c.header || "").length;
    for (const r of data.rows) {
      const v = r[c.key];
      const s = v === null || v === undefined ? "" : String(v);
      if (s.length > max) max = s.length;
    }
    // Add buffer for currency suffix on currency columns
    const buffer = colTypes[i] === "currency" ? 8 : colTypes[i] === "quantity" ? 4 : 4;
    ws.getColumn(colIdx).width = Math.min(60, Math.max(12, max + buffer));
  });

  // ===== Freeze + Filter + Print Titles =====
  ws.views = [
    {
      rightToLeft: true,
      state: "frozen",
      xSplit: 0,
      ySplit: headerRowIdx,
    },
  ];
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx + data.rows.length, column: colCount },
  };
  // Repeat header on every printed page
  (ws as any).pageSetup.printTitlesRow = `${headerRowIdx}:${headerRowIdx}`;

  // ===== Footer =====
  const footerIdx = headerRowIdx + data.rows.length + 2;
  ws.mergeCells(`A${footerIdx}:${lastColLetter}${footerIdx}`);
  const f = ws.getCell(`A${footerIdx}`);
  f.value = `${companyName}  •  تم التوليد آليًا`;
  f.font = { name: "Cairo", size: 9, italic: true, color: { argb: "FF94A3B8" } };
  f.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return { blob, fileName: data.fileName || "report" };
}

function colLetter(n: number): string {
  // 1 -> A, 27 -> AA
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function thinBorder(argb: string): ExcelJS.Borders {
  const side = { style: "thin" as const, color: { argb } };
  return { top: side, bottom: side, left: side, right: side } as ExcelJS.Borders;
}

// ---------- PDF (branded header) ----------
async function buildStatementPdfHtml(
  data: StatementExportData,
  opts?: { arabicAsEntities?: boolean },
): Promise<{ html: string; landscape: boolean }> {
  const branding = await loadBranding();
  const companyName = branding.companyName || COMPANY_NAME;
  const esc = (v: unknown) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
    );
  // Convert Arabic/RTL chars to HTML numeric entities so html2canvas rasterises
  // them from raw code points (avoids broken shaping in the WhatsApp PDF path).
  const toEntities = (s: string) =>
    s.replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, (ch) =>
      `&#x${ch.charCodeAt(0).toString(16).toUpperCase()};`,
    );
  const companyNameHtml = opts?.arabicAsEntities
    ? toEntities(esc(companyName))
    : esc(companyName);
  const summaryHtml =
    data.summary && data.summary.length
      ? `<div class="summary">${data.summary
          .map(
            (s) =>
              `<div class="sum-box"><div class="label">${esc(s.label)}</div><div class="val">${esc(s.value)}</div></div>`,
          )
          .join("")}</div>`
      : "";
  const colCount = data.columns.length;
  const useLandscape = colCount > 6;
  const pageSize = useLandscape ? "A4 landscape" : "A4 portrait";
  const fontSize = colCount > 10 ? 9 : colCount > 7 ? 10 : 11;
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(data.fileName || data.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
<style>
@page { size: ${pageSize}; margin: 0; }
*{box-sizing:border-box;font-family:'Cairo','Tajawal','Segoe UI',Tahoma,Arial,sans-serif}
html,body{margin:0;padding:0;color:#111;background:#fff;width:100%}
.page{width:100%;margin:0;padding:12mm;background:#fff}
.header{display:flex;align-items:center;gap:18px;background:#fff;padding:16px 6px 18px;width:100%}
.header .logo{width:84px;height:84px;object-fit:contain;flex-shrink:0}
.header .meta{flex:1;text-align:right;min-width:0}
.header .co-name{font-size:22px;font-weight:800;color:#0F1B3D;letter-spacing:0;line-height:1.4;white-space:nowrap;overflow:visible}
.header .report-title{font-size:15px;color:#1F2937;margin-top:6px;font-weight:700}
.header .meta-line{font-size:11px;color:#6b7280;margin-top:3px}
.gold-divider{height:2px;background:linear-gradient(90deg,transparent 0%,#C9A84C 15%,#B8923A 50%,#C9A84C 85%,transparent 100%);margin:4px 0 12px;width:100%}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin-bottom:12px;width:100%}
.sum-box{border:1px solid #e5e7eb;border-right:3px solid #C9A84C;border-radius:6px;padding:6px 10px;background:#fffaf0}
.sum-box .label{font-size:11px;color:#666}
.sum-box .val{font-size:13px;font-weight:700;margin-top:2px;color:#0F1B3D}
.table-wrap{width:100%}
table{width:100%;border-collapse:collapse;font-size:${fontSize}px;table-layout:auto}
th,td{border:1px solid #e5e7eb;padding:6px 7px;text-align:center;vertical-align:middle;word-wrap:break-word;overflow-wrap:break-word}
thead{background:#faf5e6;color:#0F1B3D}
thead th{border-color:#e5d4a1;font-weight:800;border-bottom:2px solid #B8923A}
tbody tr{page-break-inside:avoid}
tbody tr:nth-child(even){background:#fafafa}
tfoot td{font-weight:700;background:#fffaf0}
.foot{margin-top:10px;text-align:center;font-size:9px;color:#94a3b8;border-top:1px solid #e5e7eb;padding-top:6px}
@media print{
  html,body{width:100%}
  thead{display:table-header-group}
  tfoot{display:table-footer-group}
  thead th,.sum-box,tbody tr:nth-child(even),.gold-divider{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .header,.gold-divider{break-inside:avoid}
}
</style></head><body>
<div class="page">
<div class="header">
  ${branding.logoUrl ? `<img class="logo" src="${esc(branding.logoUrl)}" alt="" />` : ""}
  <div class="meta">
    <div class="co-name" style="font-family:'Cairo',Arial,sans-serif;direction:rtl;unicode-bidi:embed;text-align:right;">${companyNameHtml}</div>
    <div class="report-title">${esc(data.title)}</div>
    <div class="meta-line">${data.subtitle ? esc(data.subtitle) + " • " : ""}تاريخ التصدير: ${esc(todayLabel())}</div>
  </div>
</div>
<div class="gold-divider"></div>
${summaryHtml}
<div class="table-wrap"><table><thead><tr>${data.columns.map((c) => `<th>${esc(c.header)}</th>`).join("")}</tr></thead>
<tbody>${data.rows
    .map(
      (r) =>
        `<tr>${data.columns.map((c) => `<td style="text-align:center;vertical-align:middle;">${esc(pdfCellValue(r, c.key))}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table></div>
<div class="foot">${esc(companyName)} • تم التوليد آليًا</div>
</div>
</body></html>`;
  return { html, landscape: useLandscape };
}

export async function exportStatementToPDF(data: StatementExportData) {
  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) {
    toast.error("برجاء السماح بفتح النوافذ المنبثقة لتصدير PDF");
    return;
  }
  const { html } = await buildStatementPdfHtml(data);
  const withPrint = html.replace(
    "</body>",
    `<script>window.onload=()=>{setTimeout(()=>{window.print()},400)}</script></body>`,
  );
  w.document.open();
  w.document.write(withPrint);
  w.document.close();
}

/**
 * Build a real PDF Blob from the same HTML used by exportStatementToPDF.
 * Renders the HTML into an off-screen iframe, snapshots it with html2canvas,
 * and packs the image into a jsPDF document — preserves Arabic text rendering.
 */
export async function buildStatementPdfBlob(
  data: StatementExportData,
): Promise<{ blob: Blob; fileName: string }> {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);
  const html2canvas = (html2canvasMod as any).default || html2canvasMod;
  const { html, landscape } = await buildStatementPdfHtml(data, { arabicAsEntities: true });

  const pxWidth = landscape ? 1414 : 1000;
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${pxWidth}px;height:10px;border:0;visibility:hidden;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    // Wait for fonts (Cairo/Tajawal from Google Fonts) to actually load inside
    // the iframe — otherwise html2canvas rasterises with a fallback font that
    // breaks Arabic letter shaping.
    const fontsReady = (async () => {
      try { await (doc as any).fonts?.ready; } catch { /* ignore */ }
      try {
        await Promise.all([
          (doc as any).fonts?.load?.('700 14px "Cairo"'),
          (doc as any).fonts?.load?.('400 14px "Cairo"'),
        ].filter(Boolean));
      } catch { /* ignore */ }
    })();
    await Promise.race([fontsReady, new Promise((r) => setTimeout(r, 3500))]);
    await new Promise((r) => setTimeout(r, 200));
    iframe.style.height = `${doc.body.scrollHeight}px`;

    const canvas = await html2canvas(doc.body, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: pxWidth,
    });

    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    if (imgH <= pageH) {
      pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);
    } else {
      const pageCanvasH = Math.floor((pageH * canvas.width) / imgW);
      let y = 0;
      let first = true;
      while (y < canvas.height) {
        const sliceH = Math.min(pageCanvasH, canvas.height - y);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = sliceH;
        const ctx = slice.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const sliceData = slice.toDataURL("image/jpeg", 0.92);
        const sliceImgH = (sliceH * imgW) / canvas.width;
        if (!first) pdf.addPage();
        pdf.addImage(sliceData, "JPEG", 0, 0, imgW, sliceImgH);
        first = false;
        y += sliceH;
      }
    }

    const blob = pdf.output("blob") as Blob;
    return { blob, fileName: data.fileName || data.title };
  } finally {
    iframe.remove();
  }
}


export function ExportMenuStyles() {
  return null;
}
