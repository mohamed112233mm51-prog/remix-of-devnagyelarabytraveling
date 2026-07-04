import { toast } from "sonner";
import {
  buildStatementExcelBlob,
  buildStatementPdfBlob,
  type StatementExportData,
} from "./exportStatement";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PDF = "application/pdf";

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
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function tryNativeShare(file: File): Promise<boolean> {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    if (!nav.canShare({ files: [file] })) return false;
    await nav.share({ files: [file] });
    return true;
  } catch (e: any) {
    if (e?.name === "AbortError") return true; // user cancelled — don't fall back
    return false;
  }
}

async function shareExcel(data: StatementExportData, phone: string | null, message: string) {
  try {
    const built = await buildStatementExcelBlob(data);
    const fileName = `${built.fileName}.xlsx`;
    const typedBlob = new Blob([built.blob], { type: MIME_XLSX });
    const file = new File([typedBlob], fileName, { type: MIME_XLSX });

    // Try native share with FILES ONLY (no text — some devices ignore the
    // file when text is present and only send the message).
    if (await tryNativeShare(file)) return;

    // Fallback: download the file + open wa.me with a text hint.
    downloadBlob(typedBlob, fileName);
    toast.message("تم تنزيل الملف. أرفقه في محادثة واتساب.");
    window.open(buildWhatsappUrl(phone, message), "_blank");
  } catch (e) {
    toast.error("تعذر تجهيز ملف Excel: " + (e as Error).message);
  }
}

async function sharePdf(data: StatementExportData, phone: string | null, message: string) {
  try {
    const built = await buildStatementPdfBlob(data);
    const fileName = `${built.fileName}.pdf`;
    const typedBlob = new Blob([built.blob], { type: MIME_PDF });
    const file = new File([typedBlob], fileName, { type: MIME_PDF });

    if (await tryNativeShare(file)) return;

    downloadBlob(typedBlob, fileName);
    toast.message("تم تنزيل الملف. أرفقه في محادثة واتساب.");
    window.open(buildWhatsappUrl(phone, message), "_blank");
  } catch (e) {
    toast.error("تعذر تجهيز ملف PDF: " + (e as Error).message);
  }
}

export async function shareStatementViaWhatsApp(opts: {
  kind: "pdf" | "excel";
  data: StatementExportData;
  phone?: string | null;
}): Promise<void> {
  const phone = normalizeWhatsappPhone(opts.phone);
  const message = `مرفق ${opts.data.title}`;
  if (opts.kind === "excel") await shareExcel(opts.data, phone, message);
  else await sharePdf(opts.data, phone, message);
}
