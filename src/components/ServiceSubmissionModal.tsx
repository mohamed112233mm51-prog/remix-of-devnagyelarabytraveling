import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Modal } from "@/components/Modal";

type ServiceKey = "flight_ticket" | "security_approval" | "libyan_investment";

const OPTIONS: { value: ServiceKey; label: string; to: string; icon: string }[] = [
  { value: "flight_ticket",      label: "تذاكر طيران",  to: "/flights",            icon: "✈️" },
  { value: "security_approval",  label: "موافقة أمنية", to: "/approvals",          icon: "🛡️" },
  { value: "libyan_investment",  label: "استثمار ليبي", to: "/libyan-investment",  icon: "🏛️" },
];

export function ServiceSubmissionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [service, setService] = useState<ServiceKey | "">("");

  const proceed = () => {
    const opt = OPTIONS.find((o) => o.value === service);
    if (!opt) return;
    onClose();
    setService("");
    router.navigate({ to: opt.to, search: { tab: "add" } as any });
  };

  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="➕ تقديم خدمة"
      maxWidth={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" onClick={proceed} disabled={!service}>متابعة</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group full">
          <label>نوع الخدمة</label>
          <select value={service} onChange={(e) => setService(e.target.value as ServiceKey)}>
            <option value="" disabled>اختر نوع الخدمة...</option>
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.icon} {o.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group full" style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
          سيتم فتح نموذج التقديم الخاص بنوع الخدمة المختارة، ويتم حفظ السجل في القائمة المخصصة له:
          <ul style={{ margin: "8px 0 0", paddingInlineStart: 18 }}>
            <li>تذاكر طيران → قائمة الرحلات</li>
            <li>موافقة أمنية → قائمة الموافقات الأمنية</li>
            <li>استثمار ليبي → قائمة الاستثمار الليبي</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
