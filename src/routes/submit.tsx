import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PlusCircle } from "lucide-react";

export const Route = createFileRoute("/submit")({
  component: SubmitPage,
});

type ServiceKey = "flight_ticket" | "security_approval" | "libyan_investment";

const OPTIONS: { value: ServiceKey; label: string; to: string; icon: string; desc: string }[] = [
  { value: "flight_ticket",     label: "تذاكر طيران",  to: "/flights",           icon: "✈️", desc: "إنشاء حجز تذكرة طيران جديدة وحفظها في قائمة الرحلات" },
  { value: "security_approval", label: "موافقة أمنية", to: "/approvals",         icon: "🛡️", desc: "تقديم طلب موافقة أمنية وحفظه في قائمة الموافقات الأمنية" },
  { value: "libyan_investment", label: "استثمار ليبي", to: "/libyan-investment", icon: "🏛️", desc: "تقديم طلب استثمار ليبي وحفظه في قائمة الاستثمار الليبي" },
];

function SubmitPage() {
  const router = useRouter();
  const [service, setService] = useState<ServiceKey | "">("");

  const proceed = () => {
    const opt = OPTIONS.find((o) => o.value === service);
    if (!opt) return;
    router.navigate({ to: opt.to, search: { tab: "add" } as any });
  };

  return (
    <div dir="rtl" className="page">
      <div className="card" style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <PlusCircle size={22} strokeWidth={2.2} color="#d4af37" />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f1b3d" }}>تقديم خدمة</h2>
        </div>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 13, lineHeight: 1.7 }}>
          اختر نوع الخدمة التي تريد تقديمها. سيتم فتح نموذج التقديم الخاص بها وحفظ السجل في القائمة المخصصة له.
        </p>

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          {OPTIONS.map((o) => {
            const active = service === o.value;
            return (
              <label
                key={o.value}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                  border: active ? "1.5px solid #d4af37" : "1px solid var(--border)",
                  background: active ? "linear-gradient(180deg,#FFFBEA,#FEF3C7)" : "var(--card)",
                  boxShadow: active ? "0 2px 8px rgba(212,175,55,.18)" : "none",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="service"
                  value={o.value}
                  checked={active}
                  onChange={() => setService(o.value)}
                  style={{ accentColor: "#d4af37" }}
                />
                <span style={{ fontSize: 22 }}>{o.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#0f1b3d" }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{o.desc}</div>
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button
            className="btn btn-gold"
            onClick={proceed}
            disabled={!service}
            style={{ minWidth: 140 }}
          >
            متابعة
          </button>
        </div>
      </div>
    </div>
  );
}
