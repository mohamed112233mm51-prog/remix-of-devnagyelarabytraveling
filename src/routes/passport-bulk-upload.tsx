import { createFileRoute } from "@tanstack/react-router";
import { PassportBulkUploadWorkspace } from "@/components/PassportBulkUploadWorkspace";
import { usePerm } from "@/hooks/usePerm";

export const Route = createFileRoute("/passport-bulk-upload")({
  component: PassportBulkUploadRoute,
});

function PassportBulkUploadRoute() {
  const perm = usePerm("executions");

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
            اختر صورة واحدة، أو مجموعة صور في ضغطة واحدة، أو ملف PDF واحد يحتوي عدة جوازات. بعد القراءة تراجع البيانات ثم تنشئ التنفيذات المحددة دفعة واحدة.
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

      <PassportBulkUploadWorkspace />

      <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12, lineHeight: 1.8 }}>
        تم فصل اختيار الصور عن PDF بالكامل لتحسين توافق Android. زر «اختيار مجموعة صور» يستخدم Photo Picker للصور فقط، بينما PDF يستخدم مسار قراءة مستقل. إذا كان جهاز معين يعيد تحميل الصفحة عند اختيار مجموعة صور، يظل زر الصورة الواحدة متاحًا كحل بديل مع بقاء الحفظ النهائي جماعيًا.
      </div>
    </div>
  );
}
