import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PlusCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useLive, type Agent, type IssuingCompany } from "@/lib/db";
import { FlightForm } from "@/routes/flights";
import { ApprovalForm } from "@/routes/approvals";
import { InvestmentForm } from "@/routes/libyan-investment";

export const Route = createFileRoute("/submit")({
  component: SubmitPage,
});

type ServiceKey = "flight_ticket" | "security_approval" | "libyan_investment";

const OPTIONS: { value: ServiceKey; label: string; icon: string; desc: string }[] = [
  { value: "flight_ticket",     label: "تذاكر طيران",  icon: "✈️", desc: "إنشاء حجز تذكرة طيران جديدة وحفظها في قائمة الرحلات" },
  { value: "security_approval", label: "موافقة أمنية", icon: "🛡️", desc: "تقديم طلب موافقة أمنية وحفظه في قائمة الموافقات الأمنية" },
  { value: "libyan_investment", label: "استثمار ليبي", icon: "🏛️", desc: "تقديم طلب استثمار ليبي وحفظه في قائمة الاستثمار الليبي" },
];

function SubmitPage() {
  const [service, setService] = useState<ServiceKey | "">("");
  const [step, setStep] = useState<1 | 2>(1);
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");

  const proceed = () => {
    if (!service) return;
    setStep(2);
  };

  const reset = () => {
    setStep(1);
    setService("");
  };

  const onDone = () => {
    toast.success("تم حفظ السجل بنجاح في القائمة المخصصة");
    reset();
  };

  const current = OPTIONS.find((o) => o.value === service);

  return (
    <div dir="rtl" className="page" style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ maxWidth: 980, margin: "0 auto", padding: 22, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <PlusCircle size={22} strokeWidth={2.2} color="#d4af37" />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f1b3d" }}>تقديم خدمة</h2>
          {step === 2 && current && (
            <span style={{
              marginInlineStart: 8, fontSize: 12, fontWeight: 700,
              padding: "3px 10px", borderRadius: 999,
              background: "#FFFBEA", color: "#92400e", border: "1px solid #FDE68A",
            }}>
              {current.icon} {current.label}
            </span>
          )}
        </div>

        {step === 1 ? (
          <>
            <p style={{ marginTop: 0, color: "#64748b", fontSize: 13, lineHeight: 1.7 }}>
              اختر نوع الخدمة التي تريد تقديمها. سيظهر نموذج التقديم الخاص بها في نفس الصفحة.
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
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                املأ الحقول التالية لحفظ السجل في القائمة المخصصة لنوع الخدمة المختارة.
              </p>
              <button className="btn" onClick={reset} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ArrowRight size={14} /> تغيير نوع الخدمة
              </button>
            </div>

            <div style={{ marginTop: 4 }}>
              {service === "flight_ticket" && (
                <FlightForm agents={agents} companies={companies} onDone={onDone} />
              )}
              {service === "security_approval" && (
                <ApprovalForm agents={agents} companies={companies} onDone={onDone} />
              )}
              {service === "libyan_investment" && (
                <InvestmentForm agents={agents} companies={companies} onDone={onDone} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
