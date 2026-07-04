import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/share-test")({
  component: ShareTestPage,
});

function ShareTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [...l, s]);

  const run = async () => {
    setLog([]);
    const nav: any = navigator;
    add(`isSecureContext: ${window.isSecureContext}`);
    add(`UA: ${nav.userAgent}`);
    add(`navigator.share: ${typeof nav.share}`);
    add(`navigator.canShare: ${typeof nav.canShare}`);

    const file = new File(["Hello"], "test.txt", { type: "text/plain" });
    add(`file instanceof File: ${file instanceof File}`);
    add(`file.name: ${file.name}`);
    add(`file.size: ${file.size}`);
    add(`file.type: ${file.type}`);

    if (typeof nav.canShare !== "function") {
      add("❌ canShare غير موجود — الجهاز لا يدعم مشاركة الملفات");
      return;
    }
    let can = false;
    try { can = nav.canShare({ files: [file] }); }
    catch (e: any) { add(`canShare threw: ${e?.message || e}`); }
    add(`canShare({files:[file]}): ${can}`);

    if (!can) {
      add("❌ canShare returned false — لن يتم استدعاء share");
      return;
    }
    if (typeof nav.share !== "function") {
      add("❌ navigator.share غير موجود");
      return;
    }
    try {
      add("→ calling navigator.share({ files:[file] }) ...");
      await nav.share({ files: [file] });
      add("✅ share resolved — تم فتح نافذة المشاركة");
    } catch (e: any) {
      if (e?.name === "AbortError") add("⚠️ المستخدم أغلق نافذة المشاركة (AbortError)");
      else add(`❌ share threw: ${e?.name || ""} ${e?.message || String(e)}`);
    }
  };

  return (
    <div dir="rtl" style={{ padding: 24, fontFamily: "Cairo, Tajawal, system-ui, sans-serif", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 16 }}>اختبار Web Share API الخام</h1>
      <button
        type="button"
        onClick={run}
        style={{ padding: "12px 20px", background: "#25D366", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: "pointer" }}
      >
        اختبار مشاركة ملف
      </button>
      <pre style={{ marginTop: 20, padding: 14, background: "#0F1B3D", color: "#E6F0FF", borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.6, direction: "ltr", textAlign: "left", minHeight: 120 }}>
        {log.length ? log.join("\n") : "اضغط الزر لبدء الاختبار…"}
      </pre>
    </div>
  );
}
