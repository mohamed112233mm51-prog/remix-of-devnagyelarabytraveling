import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/share-test")({
  component: ShareTestPage,
});

function ShareTestPage() {
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [...l, s]);
  const reset = () => setLog([]);

  const shareText = async () => {
    reset();
    const nav: any = navigator;
    add(`isSecureContext: ${window.isSecureContext}`);
    add(`navigator.share: ${typeof nav.share}`);
    if (typeof nav.share !== "function") {
      add("❌ navigator.share غير موجود");
      return;
    }
    try {
      add('→ navigator.share({ title:"test", text:"hello" })');
      await nav.share({ title: "test", text: "hello" });
      add("✅ share resolved");
    } catch (e: any) {
      if (e?.name === "AbortError") add("⚠️ user cancelled (AbortError)");
      else add(`❌ share threw: ${e?.name || ""} ${e?.message || String(e)}`);
    }
  };

  const shareFile = async () => {
    reset();
    const nav: any = navigator;
    add(`isSecureContext: ${window.isSecureContext}`);
    add(`navigator.share: ${typeof nav.share}`);
    add(`navigator.canShare: ${typeof nav.canShare}`);

    const file = new File(["hello world"], "test.txt", { type: "text/plain" });
    add(`file: name=${file.name} size=${file.size} type=${file.type} instanceof File=${file instanceof File}`);

    if (typeof nav.canShare !== "function") {
      add("❌ canShare غير موجود");
      return;
    }
    let can = false;
    let err = "";
    try { can = nav.canShare({ files: [file] }); }
    catch (e: any) { err = e?.message || String(e); }
    add(`canShare({files:[file]}): ${err ? `threw: ${err}` : can}`);
    if (!can) {
      add(`❌ السبب: ${err || "canShare returned false — likely non-HTTPS/insecure context, desktop browser, or unsupported file type"}`);
      return;
    }
    try {
      add("→ navigator.share({ files:[file] })");
      await nav.share({ files: [file] });
      add("✅ share resolved — نافذة المشاركة فُتحت");
    } catch (e: any) {
      if (e?.name === "AbortError") add("⚠️ user cancelled (AbortError)");
      else add(`❌ share threw: ${e?.name || ""} ${e?.message || String(e)}`);
    }
  };

  const btn: React.CSSProperties = {
    padding: "12px 20px", color: "#fff", border: "none", borderRadius: 8,
    fontSize: 16, fontWeight: 700, cursor: "pointer",
  };

  return (
    <div dir="rtl" style={{ padding: 24, fontFamily: "Cairo, Tajawal, system-ui, sans-serif", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 16 }}>اختبار Web Share API الخام</h1>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={shareText} style={{ ...btn, background: "#0F1B3D" }}>Share Text</button>
        <button type="button" onClick={shareFile} style={{ ...btn, background: "#25D366" }}>Share Small File</button>
      </div>
      <pre style={{ marginTop: 20, padding: 14, background: "#0F1B3D", color: "#E6F0FF", borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.6, direction: "ltr", textAlign: "left", minHeight: 140 }}>
        {log.length ? log.join("\n") : "اضغط زر لبدء الاختبار…"}
      </pre>
    </div>
  );
}
