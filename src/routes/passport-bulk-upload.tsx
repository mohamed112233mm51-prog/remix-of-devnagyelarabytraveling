import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PassportBulkUploadWorkspaceV4 } from "@/components/PassportBulkUploadWorkspaceV4";
import { usePerm } from "@/hooks/usePerm";

const BULK_DRAFT_SESSION_KEY = "passport-bulk-upload:text-draft:v4";

export const Route = createFileRoute("/passport-bulk-upload")({
  component: PassportBulkUploadRoute,
});

function PassportBulkUploadRoute() {
  const perm = usePerm("executions");
  const [, forceDraftRender] = useState(0);
  const lastDraftRef = useRef("");

  // Lovable's Android preview can occasionally miss a React external-store
  // repaint while long PDF/OCR jobs continue in the background. V4 already
  // persists text-only row state in sessionStorage, so watch that same draft
  // and trigger a normal parent render whenever it changes. This does NOT
  // remount the workspace, does not retain image/PDF bytes, and does not
  // interfere with the in-flight OCR requests.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncDraft = () => {
      let next = "";
      try {
        next = window.sessionStorage.getItem(BULK_DRAFT_SESSION_KEY) || "";
      } catch {
        return;
      }
      if (next === lastDraftRef.current) return;
      lastDraftRef.current = next;
      forceDraftRender((value) => value + 1);
    };

    syncDraft();
    const timer = window.setInterval(syncDraft, 350);
    window.addEventListener("focus", syncDraft);
    document.addEventListener("visibilitychange", syncDraft);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncDraft);
      document.removeEventListener("visibilitychange", syncDraft);
    };
  }, []);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "calc(100vh - 120px)",
        display: "grid",
        alignContent: "start",
        gap: 16,
        padding: "12px 0 28px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#0f1b3d", fontWeight: 900 }}>الرفع الجماعي للجوازات</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 12, fontWeight: 700, lineHeight: 1.7 }}>
            اختر صورة واحدة، أو مجموعة صور، أو ملف PDF. في PDF تظهر كل الصفحات وحالتها أثناء القراءة، وتظل البيانات النصية المؤقتة محفوظة داخل نفس جلسة المتصفح حتى لو أعادت الواجهة الرسم.
          </p>
          <p style={{ margin: "4px 0 0", color: "#92400e", fontSize: 11, fontWeight: 800, lineHeight: 1.7 }}>
            قراءة الجوازات لا تنشئ تنفيذات تلقائيًا: بعد ظهور البيانات راجع الصفوف ثم اضغط «إنشاء التنفيذات المحددة».
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.assign("/executions");
          }}
          style={{
            minHeight: 40,
            border: "1px solid #dbe3ee",
            borderRadius: 10,
            padding: "9px 14px",
            background: "#fff",
            color: "#0f1b3d",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          العودة للتنفيذات
        </button>
      </div>

      {!perm.create && (
        <div style={{ padding: 10, borderRadius: 10, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", fontSize: 12, fontWeight: 800 }}>
          يمكنك قراءة الجوازات ومراجعتها، لكن إنشاء التنفيذات يحتاج صلاحية إنشاء في قسم التنفيذات.
        </div>
      )}

      <PassportBulkUploadWorkspaceV4 />

      <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12, lineHeight: 1.8 }}>
        ملفات الصور وPDF لا يتم حفظها في Supabase أو قاعدة البيانات. الذي يُحفظ مؤقتًا داخل sessionStorage هو النص المستخرج وحالة الصفوف فقط، ويُمسح عند مسح الدفعة أو انتهاء جلسة المتصفح.
      </div>
    </div>
  );
}
