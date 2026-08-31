import { createFileRoute } from "@tanstack/react-router";
import { BulkPassportImporter } from "@/components/BulkPassportImporter";
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
            صفحة خفيفة مخصصة لاختيار عدة صور أو ملف PDF بدون تحميل جدول التنفيذات أثناء فتح معرض الصور على الموبايل.
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

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
        <div style={{ marginBottom: 12, color: "#334155", fontSize: 13, lineHeight: 1.8 }}>
          اختر <strong>مجموعة صور جوازات</strong> أو <strong>ملف PDF واحد</strong>. الملفات تظل مؤقتة أثناء القراءة فقط ولا يتم رفعها إلى Supabase Storage أو حفظها في قاعدة البيانات.
        </div>
        {!perm.create && (
          <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", fontSize: 12, fontWeight: 800 }}>
            يمكنك تجربة قراءة الملفات ومراجعتها، لكن إنشاء التنفيذات يحتاج صلاحية إنشاء في قسم التنفيذات.
          </div>
        )}
        <BulkPassportImporter />
      </div>

      <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12, lineHeight: 1.8 }}>
        لو Android أعاد تحميل هذه الصفحة نفسها أثناء اختيار الصور، جرّب عددًا أقل من الصور في الدفعة؛ أما صفحة التنفيذات الثقيلة فلم تعد موجودة في الذاكرة أثناء الاختيار.
      </div>
    </div>
  );
}
