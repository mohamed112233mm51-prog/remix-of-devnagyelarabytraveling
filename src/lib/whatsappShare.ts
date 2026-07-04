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

async function shareExcel(data: StatementExportData, phone: string | null, message: string) {
  // 1) Open WhatsApp FIRST (same user gesture)
  window.open(buildWhatsappUrl(phone, message), "_blank");
  // 2) Then build + download the file
  try {
    const built = await buildStatementExcelBlob(data);
    const fileName = `${built.fileName}.xlsx`;
    const typedBlob = new Blob([built.blob], { type: MIME_XLSX });
    downloadBlob(typedBlob, fileName);
    toast.message("تم تنزيل الملف. أرفقه في محادثة واتساب.");
  } catch (e) {
    toast.error("تعذر تجهيز ملف Excel: " + (e as Error).message);
  }
}

async function sharePdf(data: StatementExportData, phone: string | null, message: string) {
  // Mirrors shareExcel exactly — only MIME type and extension differ.
  window.open(buildWhatsappUrl(phone, message), "_blank");
  try {
    const built = await buildStatementPdfBlob(data);
    const fileName = `${built.fileName}.pdf`;
    const typedBlob = new Blob([built.blob], { type: MIME_PDF });
    downloadBlob(typedBlob, fileName);
    toast.message("تم تنزيل الملف. أرفقه في محادثة واتساب.");
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
