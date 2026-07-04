import { toast } from "sonner";
import { buildStatementExcelBlob, exportStatementToPDF, type StatementExportData } from "./exportStatement";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Kept for backwards compatibility with existing callers. Not used anymore. */
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

/**
 * Try to share a File via the native Web Share API (files only, no text, no
 * wa.me URL). Returns true if the share sheet was shown (including user
 * cancellation). Returns false when file sharing is unsupported.
 */
async function tryShareFile(file: File, title: string): Promise<boolean> {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  console.log("[WA-Share] isSecureContext =", typeof window !== "undefined" ? window.isSecureContext : "n/a", "UA =", nav?.userAgent);
  console.log("[WA-Share] navigator.share =", nav?.share);
  console.log("[WA-Share] navigator.canShare =", nav?.canShare);
  console.log("[WA-Share] file instanceof File =", file instanceof File, "name=", file.name, "size=", file.size, "type=", file.type);
  if (!nav || typeof nav.share !== "function") {
    console.warn("[WA-Share] FALLBACK reason: navigator.share is not a function");
    return false;
  }
  if (typeof nav.canShare !== "function") {
    console.warn("[WA-Share] FALLBACK reason: navigator.canShare is not a function");
    return false;
  }
  let canShareFiles = false;
  try { canShareFiles = nav.canShare({ files: [file] }); }
  catch (e) { console.warn("[WA-Share] canShare threw:", e); }
  console.log("[WA-Share] canShare({files:[file]}) =", canShareFiles);
  if (!canShareFiles) {
    console.warn("[WA-Share] FALLBACK reason: canShare({files}) returned false (likely non-HTTPS/insecure context, desktop browser, or unsupported MIME)");
    return false;
  }
  try {
    console.log("[WA-Share] SHARE PATH → calling navigator.share(...)");
    await nav.share({ title, files: [file] });
    console.log("[WA-Share] navigator.share resolved OK");
    return true;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      console.log("[WA-Share] User cancelled share (AbortError) — no fallback");
      return true;
    }
    console.warn("[WA-Share] FALLBACK reason: navigator.share threw:", e);
    return false;
  }
}

/**
 * Share a statement via the device's native share sheet. The user picks
 * WhatsApp (or any other app) from the sheet and the file is already attached.
 * No text message, no wa.me link, no specific conversation is opened.
 */
export async function shareStatementViaWhatsApp(opts: {
  kind: "pdf" | "excel";
  data: StatementExportData;
  /** Deprecated — kept for callers, ignored. Native share sheet handles routing. */
  phone?: string | null;
}): Promise<void> {
  const baseName = opts.data.fileName || opts.data.title;

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

    const shared = await tryShareFile(file, opts.data.title);
    if (shared) return;

    toast.message("جهازك لا يدعم مشاركة الملفات مباشرة. سيتم تنزيل الملف لإرفاقه يدوياً.");
    downloadBlob(typedBlob, fileName);
    return;
  }

  // PDF path — the existing PDF exporter uses a print window (no Blob is
  // produced), and the user requested we not change the export engine. Fall
  // back to the existing PDF flow so the user can save/print the file.
  toast.message("مشاركة PDF المباشرة غير متاحة على هذا الجهاز. سيتم فتح نافذة PDF لحفظه وإرفاقه يدوياً.");
  await exportStatementToPDF(opts.data);
  void baseName;
}
