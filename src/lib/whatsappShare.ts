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

function showDiagnosticDialog(report: Record<string, unknown>) {
  const text = Object.entries(report)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  if (typeof document === "undefined") return;
  const overlay = document.createElement("div");
  overlay.setAttribute("dir", "rtl");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Cairo,Tajawal,system-ui,sans-serif;";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3);";
  box.innerHTML = `
    <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;background:#fffaf0">
      <strong style="color:#0F1B3D">تشخيص مشاركة واتساب</strong>
      <button type="button" id="__wa_diag_close" style="background:#0F1B3D;color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer">إغلاق</button>
    </div>
    <pre style="margin:0;padding:14px 16px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;direction:ltr;text-align:left">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>
    <div style="padding:10px 16px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;background:#fafafa">
      <button type="button" id="__wa_diag_copy" style="background:#C9A84C;color:#1F1A0A;border:none;border-radius:6px;padding:8px 14px;cursor:pointer;font-weight:700">نسخ التقرير</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  box.querySelector<HTMLButtonElement>("#__wa_diag_close")!.onclick = close;
  box.querySelector<HTMLButtonElement>("#__wa_diag_copy")!.onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast.success("تم نسخ التقرير"); }
    catch { toast.error("تعذر النسخ"); }
  };
}

async function tryShareFile(file: File, title: string): Promise<boolean> {
  const nav: any = typeof navigator !== "undefined" ? navigator : null;
  const report: Record<string, unknown> = {
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : "n/a",
    userAgent: nav?.userAgent ?? "n/a",
    "navigator.share exists": typeof nav?.share === "function",
    "navigator.canShare exists": typeof nav?.canShare === "function",
    "file instanceof File": file instanceof File,
    "file.name": file.name,
    "file.size": file.size,
    "file.type": file.type,
    "canShare({files})": "not-evaluated",
    path: "pending",
    fallbackReason: "",
  };

  const finish = (path: string, reason = "") => {
    report.path = path;
    report.fallbackReason = reason;
    showDiagnosticDialog(report);
  };

  if (!nav || typeof nav.share !== "function") {
    finish("FALLBACK DOWNLOAD", "navigator.share is not a function");
    return false;
  }
  if (typeof nav.canShare !== "function") {
    finish("FALLBACK DOWNLOAD", "navigator.canShare is not a function");
    return false;
  }
  let canShareFiles = false;
  let canShareErr = "";
  try { canShareFiles = nav.canShare({ files: [file] }); }
  catch (e: any) { canShareErr = String(e?.message || e); }
  report["canShare({files})"] = canShareErr ? `threw: ${canShareErr}` : canShareFiles;
  if (!canShareFiles) {
    finish(
      "FALLBACK DOWNLOAD",
      canShareErr
        ? `canShare threw: ${canShareErr}`
        : "canShare({files:[file]}) returned false — likely non-HTTPS/insecure context, desktop browser, or unsupported MIME type",
    );
    return false;
  }
  try {
    await nav.share({ title, files: [file] });
    finish("SHARE PATH (navigator.share resolved)");
    return true;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      finish("SHARE PATH (user cancelled — AbortError)");
      return true;
    }
    finish("FALLBACK DOWNLOAD", `navigator.share threw: ${e?.name || ""} ${e?.message || String(e)}`);
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
