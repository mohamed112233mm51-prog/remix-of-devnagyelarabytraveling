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
      <style>{`
        .passport-bulk-workspace > div > div:first-of-type > div:first-child {
          display: grid !important;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px !important;
          align-items: stretch !important;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(-n + 3) {
          min-height: 58px !important;
          width: 100%;
          justify-content: center !important;
          gap: 9px !important;
          padding: 11px 14px !important;
          border: 1px solid #d7e1ee !important;
          border-radius: 14px !important;
          background: #ffffff !important;
          color: #0f1b3d !important;
          font-size: 13px !important;
          font-weight: 900 !important;
          box-shadow: 0 2px 8px rgba(15, 27, 61, 0.06) !important;
          transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease !important;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(-n + 3):not(:disabled):hover {
          transform: translateY(-1px);
          border-color: #93b5dd !important;
          background: #fbfdff !important;
          box-shadow: 0 7px 18px rgba(15, 27, 61, 0.10) !important;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(-n + 3):focus-visible,
        .passport-bulk-workspace > div > div:nth-of-type(2) > button:focus-visible,
        .passport-bulk-workspace > div > div[style*="position: sticky"] > button:focus-visible {
          outline: 3px solid rgba(37, 99, 235, 0.20) !important;
          outline-offset: 2px;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(-n + 3) > svg {
          width: 36px !important;
          height: 36px !important;
          flex: 0 0 36px;
          padding: 8px;
          border-radius: 10px;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(1) > svg {
          color: #1d4ed8;
          background: #eff6ff;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(2) > svg {
          color: #6d28d9;
          background: #f5f3ff;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(3) > svg {
          color: #b42318;
          background: #fff1f2;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(4) {
          grid-column: 1 / -1;
          justify-self: start;
          min-height: 38px !important;
          padding: 7px 11px !important;
          border: 1px solid #fecaca !important;
          border-radius: 10px !important;
          background: #fff7f7 !important;
          color: #b91c1c !important;
          font-size: 12px !important;
          font-weight: 800 !important;
          box-shadow: none !important;
        }

        .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:disabled {
          cursor: not-allowed !important;
          opacity: .52 !important;
          transform: none !important;
          box-shadow: none !important;
        }

        .passport-bulk-workspace > div > div:nth-of-type(2) > button.btn-secondary {
          min-height: 44px !important;
          margin-top: 12px !important;
          padding: 9px 18px !important;
          border: 1px solid #bfdbfe !important;
          border-radius: 12px !important;
          background: #eff6ff !important;
          color: #1d4ed8 !important;
          font-size: 13px !important;
          font-weight: 900 !important;
          box-shadow: 0 2px 7px rgba(37, 99, 235, .08) !important;
          transition: background .16s ease, border-color .16s ease, transform .16s ease !important;
        }

        .passport-bulk-workspace > div > div:nth-of-type(2) > button.btn-secondary:not(:disabled):hover {
          background: #dbeafe !important;
          border-color: #93c5fd !important;
          transform: translateY(-1px);
        }

        .passport-bulk-workspace > div > div[style*="position: sticky"] {
          padding: 12px 14px !important;
          border: 1px solid #cbd8e8 !important;
          border-radius: 16px !important;
          background: rgba(255, 255, 255, .985) !important;
          box-shadow: 0 12px 30px rgba(15, 27, 61, .13) !important;
          backdrop-filter: blur(10px);
        }

        .passport-bulk-workspace > div > div[style*="position: sticky"] > button.btn-primary {
          min-height: 50px !important;
          padding: 11px 20px !important;
          border: 1px solid #1d4ed8 !important;
          border-radius: 13px !important;
          background: #1d4ed8 !important;
          color: #ffffff !important;
          font-size: 14px !important;
          font-weight: 900 !important;
          box-shadow: 0 8px 20px rgba(29, 78, 216, .24) !important;
          transition: background .16s ease, transform .16s ease, box-shadow .16s ease !important;
        }

        .passport-bulk-workspace > div > div[style*="position: sticky"] > button.btn-primary:not(:disabled):hover {
          background: #1e40af !important;
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(29, 78, 216, .30) !important;
        }

        .passport-bulk-workspace > div > div[style*="position: sticky"] > button.btn-primary:disabled,
        .passport-bulk-workspace > div > div:nth-of-type(2) > button.btn-secondary:disabled {
          cursor: not-allowed !important;
          opacity: .48 !important;
          transform: none !important;
          box-shadow: none !important;
        }

        @media (max-width: 700px) {
          .passport-bulk-workspace > div > div:first-of-type > div:first-child {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(3),
          .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(4) {
            grid-column: 1 / -1;
          }

          .passport-bulk-workspace > div > div:nth-of-type(2) > button.btn-secondary,
          .passport-bulk-workspace > div > div[style*="position: sticky"] > button.btn-primary {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .passport-bulk-workspace > div > div:first-of-type > div:first-child {
            grid-template-columns: 1fr;
          }

          .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(3),
          .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(4) {
            grid-column: auto;
          }

          .passport-bulk-workspace > div > div:first-of-type > div:first-child > button:nth-child(-n + 3) {
            justify-content: flex-start !important;
          }
        }
      `}</style>

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

      <div className="passport-bulk-workspace">
        <PassportBulkUploadWorkspaceV4 />
      </div>

      <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12, lineHeight: 1.8 }}>
        ملفات الصور وPDF لا يتم حفظها في Supabase أو قاعدة البيانات. الذي يُحفظ مؤقتًا داخل sessionStorage هو النص المستخرج وحالة الصفوف فقط، ويُمسح عند مسح الدفعة أو انتهاء جلسة المتصفح.
      </div>
    </div>
  );
}
