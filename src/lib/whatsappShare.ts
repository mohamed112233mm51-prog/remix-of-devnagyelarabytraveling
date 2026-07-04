import { toast } from "sonner";
import { buildStatementExcelBlob, exportStatementToPDF, type StatementExportData } from "./exportStatement";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Normalize a phone number for use with wa.me. */
export function normalizeWhatsappPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D+/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "20" + d.slice(1);
  else if (d.length === 10 && d.startsWith("1")) d = "20" + d;
  return d;
}

function buildWhatsappUrl(phone?: string | null, text?: string) {
  const base = phone ? `https://wa.me/${phone}` : "https://wa.me/";
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Called synchronously from the click handler — opens WhatsApp in a new tab
 * FIRST so the browser accepts it as a user-gesture-driven popup. Then does
 * the async export work and downloads the file so it's ready in Downloads.
 */
export async function shareStatementViaWhatsApp(opts: {
  kind: "pdf" | "excel";
  data: StatementExportData;
  phone?: string | null;
}): Promise<void> {
  const phone = normalizeWhatsappPhone(opts.phone);
  const message = `مرفق ${opts.data.title}`;

  // 1) MUST be the first line — open WhatsApp inside the click gesture,
  //    before any await/setTimeout, or mobile browsers block the popup.
  const waWin = window.open(buildWhatsappUrl(phone, message), "_blank");

  // 2) Now do the async export + download.
  if (opts.kind === "excel") {
    try {
      const built = await buildStatementExcelBlob(opts.data);
      const fileName = `${built.fileName}.xlsx`;
      const typedBlob = new Blob([built.blob], { type: MIME_XLSX });
      downloadBlob(typedBlob, fileName);
      toast.message("تم تنزيل الملف. أرفقه في محادثة واتساب.");
    } catch (e) {
      toast.error("تعذر تجهيز ملف Excel: " + (e as Error).message);
    }
    return;
  }

  // PDF path — existing exporter opens a print window (no Blob). Keep it.
  try {
    await exportStatementToPDF(opts.data);
    toast.message("احفظ ملف PDF ثم أرفقه في محادثة واتساب.");
  } catch (e) {
    toast.error("تعذر تصدير PDF: " + (e as Error).message);
    if (waWin && !waWin.closed) waWin.close();
  }
}
