import { toast } from "sonner";
import { buildStatementExcelBlob, exportStatementToPDF, type StatementExportData } from "./exportStatement";
import { loadBranding, DEFAULT_COMPANY_NAME } from "./branding";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PDF = "application/pdf";

/**
 * Normalize a phone number for use with wa.me.
 * Strips everything except digits. Adds default country code (20 = EG) if the
 * number starts with 0 or is 10 digits (local EG mobile).
 */
export function normalizeWhatsappPhone(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D+/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "20" + d.slice(1);
  else if (d.length === 10 && d.startsWith("1")) d = "20" + d;
  return d;
}

function buildMessage(companyName: string, title: string, fileName: string): string {
  return [
    "السلام عليكم،",
    `مرفق لكم ${title}.`,
    fileName,
    "",
    `مع تحيات`,
    companyName,
  ].join("\n");
}

function openWaFallback(phone: string, message: string) {
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
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
 * Try to share a File via Web Share API. Returns true if the share dialog was
 * shown (or completed / cancelled). Returns false if file sharing is not
 * supported and the caller should fall back to download + wa.me link.
 */
async function tryShareFile(file: File, title: string, text: string): Promise<boolean> {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  if (!nav || typeof nav.share !== "function") return false;
  if (typeof nav.canShare !== "function" || !nav.canShare({ files: [file] })) return false;
  try {
    await nav.share({ title, text, files: [file] });
    return true;
  } catch (e: any) {
    // User cancelled — treat as handled, don't fall back to download.
    if (e?.name === "AbortError") return true;
    return false;
  }
}

/** Share a statement via WhatsApp. Reuses the existing PDF/Excel export pipeline. */
export async function shareStatementViaWhatsApp(opts: {
  kind: "pdf" | "excel";
  data: StatementExportData;
  phone?: string | null;
}): Promise<void> {
  const phone = normalizeWhatsappPhone(opts.phone);
  if (!phone) {
    toast.error("لا يوجد رقم واتساب مسجل لهذا الحساب.");
    return;
  }

  const branding = await loadBranding().catch(() => null);
  const companyName = branding?.companyName || DEFAULT_COMPANY_NAME;
  const baseName = opts.data.fileName || opts.data.title;
  const ext = opts.kind === "excel" ? "xlsx" : "pdf";
  const fullName = `${baseName}.${ext}`;
  const message = buildMessage(companyName, opts.data.title, fullName);

  if (opts.kind === "excel") {
    let blob: Blob;
    let baseFileName: string;
    try {
      const built = await buildStatementExcelBlob(opts.data);
      blob = built.blob;
      baseFileName = built.fileName;
    } catch (e) {
      toast.error("تعذر تجهيز ملف Excel للإرسال: " + (e as Error).message);
      return;
    }
    const fileName = `${baseFileName}.xlsx`;
    // Rebuild the Blob with the correct MIME type to guarantee Web Share
    // recognizes it as an Excel spreadsheet (not application/octet-stream).
    const typedBlob = new Blob([blob], { type: MIME_XLSX });
    const file = new File([typedBlob], fileName, { type: MIME_XLSX });

    const shared = await tryShareFile(file, opts.data.title, message);
    if (shared) return;

    // Fallback: download the file so the user can attach it manually.
    toast.message("مشاركة الملفات غير مدعومة على هذا الجهاز. سيتم تنزيل الملف لإرفاقه يدوياً في واتساب.");
    downloadBlob(typedBlob, fileName);
    openWaFallback(phone, message);
    return;
  }

  // PDF path — the existing PDF export uses a print window (no Blob is
  // produced). We keep that pipeline unchanged and always fall back to the
  // download/print flow + wa.me link with the message.
  await exportStatementToPDF(opts.data);
  toast.message("تم فتح نافذة PDF. برجاء حفظ الملف ثم إرفاقه في محادثة واتساب.");
  openWaFallback(phone, message);
}
