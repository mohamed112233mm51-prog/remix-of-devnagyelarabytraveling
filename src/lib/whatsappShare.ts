import { toast } from "sonner";
import { buildStatementExcelBlob, exportStatementToPDF, type StatementExportData } from "./exportStatement";
import { loadBranding, DEFAULT_COMPANY_NAME } from "./branding";

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
  // If a local Egyptian number (starts with 0 → 010/011/012/015...), replace 0 with 20.
  if (d.startsWith("0")) d = "20" + d.slice(1);
  // 10 digits starting with 1 → Egyptian mobile without leading 0.
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
    try {
      const { blob, fileName } = await buildStatementExcelBlob(opts.data);
      const file = new File([blob], `${fileName}.xlsx`, { type: blob.type });
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (nav?.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], text: message, title: opts.data.title });
          return;
        } catch (e: any) {
          if (e?.name === "AbortError") return;
        }
      }
      // Fallback: download the file, then open WhatsApp with the text.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.message("تم تنزيل الملف. برجاء إرفاقه في محادثة واتساب التي ستفتح الآن.");
    } catch (e) {
      toast.error("تعذر تجهيز ملف Excel للإرسال: " + (e as Error).message);
      return;
    }
  } else {
    // PDF uses a print window; there is no Blob to share, so we open the print
    // window for the user to save/print, and open WhatsApp with the text.
    await exportStatementToPDF(opts.data);
    toast.message("تم فتح نافذة PDF. برجاء حفظ الملف ثم إرفاقه في محادثة واتساب.");
  }

  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
