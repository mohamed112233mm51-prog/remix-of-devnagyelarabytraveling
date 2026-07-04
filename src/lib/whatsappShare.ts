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

function openWhatsapp(phone?: string | null, text?: string) {
  const params = new URLSearchParams();
  if (phone) params.set("phone", phone);
  if (text) params.set("text", text);
  const qs = params.toString();
  window.location.href = `whatsapp://send${qs ? `?${qs}` : ""}`;
}

/**
 * Try native share first (canShare is unreliable for some MIME types).
 * On any failure: download the file, wait 1s so it lands in Downloads,
 * then open the installed WhatsApp app via the whatsapp:// scheme.
 */
async function shareOrFallback(file: File, blob: Blob, fileName: string, phone: string | null, message: string) {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ files: [file] });
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") return; // user cancelled — don't fall back
    }
  }
  downloadBlob(blob, fileName);
  toast.message("تم تنزيل الملف. سيتم فتح واتساب لإرفاقه يدوياً في المحادثة.");
  setTimeout(() => openWhatsapp(phone, message), 1000);
}

export async function shareStatementViaWhatsApp(opts: {
  kind: "pdf" | "excel";
  data: StatementExportData;
  phone?: string | null;
}): Promise<void> {
  const phone = normalizeWhatsappPhone(opts.phone);
  const baseName = opts.data.fileName || opts.data.title;
  const message = `مرفق ${opts.data.title}`;

  if (opts.kind === "excel") {
    let blob: Blob;
    let baseFileName: string;
    try {
      const built = await buildStatementExcelBlob(opts.data);
      blob = built.blob;
      baseFileName = built.fileName;
    } catch (e) {
      toast.error("تعذر تجهيز ملف Excel للمشاركة: " + (e as Error).message);
      return;
    }
    const fileName = `${baseFileName}.xlsx`;
    const typedBlob = new Blob([blob], { type: MIME_XLSX });
    const file = new File([typedBlob], fileName, { type: MIME_XLSX });
    await shareOrFallback(file, typedBlob, fileName, phone, message);
    return;
  }

  // PDF export uses a print window (no Blob available). Keep that pipeline
  // and open WhatsApp alongside so user can attach the saved PDF manually.
  await exportStatementToPDF(opts.data);
  toast.message("تم فتح نافذة PDF. احفظ الملف ثم أرفقه في محادثة واتساب.");
  openWhatsapp(phone, message);
  void baseName;
}
