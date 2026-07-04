import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/share-test")({
  component: ShareTestPage,
});

// Minimal 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Minimal valid PDF (single blank page).
const MINIMAL_PDF =
  "%PDF-1.1\n%¥±ë\n\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n" +
  "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n\n" +
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n\n" +
  "xref\n0 4\n0000000000 65535 f \n0000000018 00000 n \n" +
  "0000000063 00000 n \n0000000108 00000 n \n" +
  "trailer << /Size 4 /Root 1 0 R >>\nstartxref\n170\n%%EOF";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function ShareTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const push = (s: string) => { console.log("[share-test]", s); setLog((l) => [...l, s]); };
  const reset = () => setLog([]);

  const runShare = async (file: File) => {
    const nav: any = navigator;
    push(`isSecureContext: ${window.isSecureContext}`);
    push(`UA: ${nav.userAgent}`);
    push(`typeof navigator.share: ${typeof nav.share}`);
    push(`typeof navigator.canShare: ${typeof nav.canShare}`);
    push(`file.name: ${file.name}`);
    push(`file.size: ${file.size}`);
    push(`file.type: ${file.type}`);
    push(`file instanceof File: ${file instanceof File}`);

    // canShare without files
    try { push(`canShare(file as data): ${nav.canShare?.({ title: file.name }) }`); }
    catch (e: any) { push(`canShare(title) threw: ${e?.message || e}`); }

    if (typeof nav.canShare !== "function") {
      push("❌ canShare غير موجود — الجهاز/المتصفح لا يدعم مشاركة الملفات");
      return;
    }
    let can = false, err = "";
    try { can = nav.canShare({ files: [file] }); }
    catch (e: any) { err = e?.message || String(e); }
    push(`canShare({files:[file]}): ${err ? `threw: ${err}` : can}`);

    if (!can) {
      push(`❌ السبب: ${err ||
        "canShare رجع false — على الأرجح: (أ) نوع الملف غير مسموح للمشاركة في هذا المتصفح، (ب) desktop Chrome بدون امتداد share، (ج) sandboxed iframe (Lovable preview) بدون سماحية web-share، (د) non-HTTPS."}`);
      return;
    }
    try {
      push("→ navigator.share({ files:[file] })");
      await nav.share({ files: [file] });
      push("✅ share resolved — نافذة المشاركة فُتحت");
    } catch (e: any) {
      if (e?.name === "AbortError") push("⚠️ user cancelled (AbortError)");
      else push(`❌ share threw: ${e?.name || ""} ${e?.message || String(e)}`);
    }
  };

  const testExcel = async () => {
    reset();
    push("=== Excel test ===");
    const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    // Note: not a real xlsx binary — canShare gates on MIME, not content.
    const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], { type: XLSX });
    await runShare(new File([blob], "test.xlsx", { type: XLSX }));
  };

  const testPng = async () => {
    reset();
    push("=== PNG test ===");
    const bytes = b64ToBytes(PNG_BASE64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" });
    await runShare(new File([blob], "test.png", { type: "image/png" }));
  };

  const testPdf = async () => {
    reset();
    push("=== PDF test ===");
    const blob = new Blob([MINIMAL_PDF], { type: "application/pdf" });
    await runShare(new File([blob], "test.pdf", { type: "application/pdf" }));
  };

  const testText = async () => {
    reset();
    push("=== TXT test ===");
    const blob = new Blob(["hello"], { type: "text/plain" });
    await runShare(new File([blob], "test.txt", { type: "text/plain" }));
  };

  const btn: React.CSSProperties = {
    padding: "12px 16px", color: "#fff", border: "none", borderRadius: 8,
    fontSize: 15, fontWeight: 700, cursor: "pointer",
  };

  return (
    <div dir="rtl" style={{ padding: 24, fontFamily: "Cairo, Tajawal, system-ui, sans-serif", maxWidth: 780, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>تشخيص Web Share API</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        صفحة مستقلة تماماً — لا تستخدم أي جزء من نظام الواتساب أو تصدير Excel/PDF.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={testExcel} style={{ ...btn, background: "#1f7a3a" }}>اختبار مشاركة ملف Excel</button>
        <button type="button" onClick={testPng}   style={{ ...btn, background: "#0F1B3D" }}>اختبار مشاركة صورة PNG</button>
        <button type="button" onClick={testPdf}   style={{ ...btn, background: "#a63737" }}>اختبار مشاركة PDF</button>
        <button type="button" onClick={testText}  style={{ ...btn, background: "#6b7280" }}>اختبار مشاركة نص TXT</button>
      </div>
      <pre style={{ marginTop: 20, padding: 14, background: "#0F1B3D", color: "#E6F0FF", borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.6, direction: "ltr", textAlign: "left", minHeight: 160 }}>
        {log.length ? log.join("\n") : "اضغط زر لبدء الاختبار…"}
      </pre>
    </div>
  );
}
