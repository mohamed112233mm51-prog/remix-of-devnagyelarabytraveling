import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBranding, BRAND_NAVY, BRAND_GOLD } from "@/lib/branding";

export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const branding = useBranding();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return toast.error("كلمة المرور 8 أحرف على الأقل");
    if (pw !== pw2) return toast.error("كلمتا المرور غير متطابقتين");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تم تعيين كلمة المرور");
    onDone();
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "linear-gradient(135deg,#f5f7fb 0%,#e8ecf4 100%)", padding: 16, fontFamily: "'Cairo','Tajawal',sans-serif" }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, background: "#fff", padding: 28, borderRadius: 16, boxShadow: "0 12px 40px rgba(15,27,61,.12)", borderTop: `4px solid ${BRAND_GOLD}` }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14 }}>
          {branding.logoUrl && (
            <img
              src={branding.logoUrl}
              alt={branding.companyName}
              className="brand-logo brand-logo--login"
              decoding="async"
              draggable={false}
            />
          )}
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color: BRAND_NAVY, textAlign: "center" }}>
            {branding.companyName}
          </div>
          <div style={{ marginTop: 6, height: 3, width: 42, background: BRAND_GOLD, borderRadius: 2 }} />
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, textAlign: "center", color: BRAND_NAVY }}>تعيين كلمة المرور</h1>
        <p style={{ marginTop: 6, color: "#6b7280", fontSize: 12, textAlign: "center" }}>أهلاً {email} — أنشئ كلمة مرور لحسابك للمتابعة.</p>
        <label style={lbl}>كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required style={inp} />
        <label style={lbl}>تأكيد كلمة المرور</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required style={inp} />
        <button type="submit" disabled={busy} style={{ marginTop: 18, width: "100%", padding: "12px 16px", borderRadius: 10, background: BRAND_NAVY, color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}>
          {busy ? "..." : "حفظ والمتابعة"}
        </button>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 13, marginTop: 12, color: "#334155", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, marginTop: 4 };
