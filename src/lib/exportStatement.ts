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
export async function exportStatementToExcel(data: StatementExportData) {
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
  r3.value = `${subtitleBit}تاريخ التصدير: ${todayLabel()}    صادر بواسطة: ${userLabel}`;
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.fileName || "report"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
export async function exportStatementToPDF(data: StatementExportData) {
  const w = window.open("", "_blank", "width=1024,height=768");
  if (!w) {
    toast.error("برجاء السماح بفتح النوافذ المنبثقة لتصدير PDF");
    return;
  }
  const branding = await loadBranding();
  const companyName = branding.companyName || COMPANY_NAME;
  const userLabel = await getCurrentUserLabel();
  const esc = (v: unknown) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
    );
  const summaryHtml =
    data.summary && data.summary.length
      ? `<div class="summary">${data.summary
          .map(
            (s) =>
              `<div class="sum-box"><div class="label">${esc(s.label)}</div><div class="val">${esc(s.value)}</div></div>`,
          )
          .join("")}</div>`
      : "";
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(data.title)}</title>
<style>
*{box-sizing:border-box;font-family:'Cairo','Tajawal','Segoe UI',Tahoma,Arial,sans-serif}
body{margin:0;color:#111;background:#fff}
.page{padding:24px}
.brand-bar{display:flex;align-items:center;gap:14px;background:linear-gradient(135deg,#0F1B3D 0%,#1a2a5e 100%);color:#fff;padding:14px 18px;border-radius:10px;margin-bottom:14px;border-bottom:3px solid #C9A84C}
.brand-bar .logo{width:56px;height:56px;object-fit:contain;background:#fff;border-radius:8px;padding:4px;flex-shrink:0}
.brand-bar .meta{flex:1;text-align:right}
.brand-bar .co-name{font-size:18px;font-weight:800;letter-spacing:.2px}
.brand-bar .report-title{font-size:13px;color:#C9A84C;margin-top:4px;font-weight:700}
.brand-bar .meta-line{font-size:11px;opacity:.85;margin-top:2px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:16px}
.sum-box{border:1px solid #e5e7eb;border-left:3px solid #C9A84C;border-radius:8px;padding:8px 12px;background:#f9fafb}
.sum-box .label{font-size:12px;color:#666}
.sum-box .val{font-size:15px;font-weight:700;margin-top:2px;color:#0F1B3D}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:center}
thead{background:#0F1B3D;color:#fff}
thead th{border-color:#C9A84C}
tbody tr:nth-child(even){background:#f8fafc}
tfoot td{font-weight:700;background:#f9fafb}
.foot{margin-top:14px;text-align:center;font-size:10px;color:#94a3b8;border-top:1px solid #e5e7eb;padding-top:8px}
@media print{.page{margin:8mm;padding:0}thead{display:table-header-group}.brand-bar{break-inside:avoid}}
</style></head><body>
<div class="page">
<div class="brand-bar">
  ${branding.logoUrl ? `<img class="logo" src="${esc(branding.logoUrl)}" alt="" />` : ""}
  <div class="meta">
    <div class="co-name">${esc(companyName)}</div>
    <div class="report-title">${esc(data.title)}</div>
    <div class="meta-line">${data.subtitle ? esc(data.subtitle) + " • " : ""}تاريخ التصدير: ${esc(todayLabel())} • صادر بواسطة: ${esc(userLabel)}</div>
  </div>
</div>
${summaryHtml}
<table><thead><tr>${data.columns.map((c) => `<th>${esc(c.header)}</th>`).join("")}</tr></thead>
<tbody>${data.rows
    .map(
      (r) =>
        `<tr>${data.columns.map((c) => `<td>${esc(r[c.key])}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>
<div class="foot">${esc(companyName)} • تم التوليد آليًا</div>
</div>
<script>window.onload=()=>{setTimeout(()=>{window.print()},400)}</script>
</body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function ExportMenuStyles() {
  return null;
}
