import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBranding, BRAND_NAVY, BRAND_GOLD } from "@/lib/branding";
import { toast } from "sonner";

export default function Login() {
  const { signIn, signInWithGoogle, blocked, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"login" | "forgot">("login");
  const branding = useBranding();


  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setLoading(false);
      return toast.error("بيانات الدخول غير صحيحة");
    }
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: profile } = await supabase
      .from("profiles")
      .select("invite_accepted, is_active")
      .eq("email", email.trim())
      .maybeSingle();
    setLoading(false);
    if (profile && profile.invite_accepted === false) {
      await supabase.auth.signOut();
      toast.error("برجاء تفعيل الحساب من رابط الدعوة أولاً");
    } else if (profile && profile.is_active === false) {
      await supabase.auth.signOut();
      toast.error("هذا الحساب غير مفعل");
    }
  }

  if (blocked) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={card}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#dc2626" }}>غير مصرح بالدخول</h1>
          <p style={{ marginTop: 10, color: "#374151", fontSize: 14 }}>
            {blocked === "not_invited"
              ? "هذا الحساب غير مدعو للنظام. يرجى التواصل مع المسؤول."
              : "تم تعطيل حسابك. يرجى التواصل مع المسؤول."}
          </p>
          <button onClick={signOut} style={btn}>تسجيل الخروج</button>
        </div>
      </div>
    );
  }

  if (view === "forgot") {
    return <ForgotPassword initialEmail={email} onBack={() => setView("login")} />;
  }

  return (
    <div dir="rtl" style={wrap}>
      <form onSubmit={onSubmit} style={card}>
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
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800, color: BRAND_NAVY, letterSpacing: ".2px", textAlign: "center" }}>
            {branding.companyName}
          </div>
          <div style={{ marginTop: 6, height: 3, width: 42, background: BRAND_GOLD, borderRadius: 2 }} />
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, marginBottom: 6, textAlign: "center", color: BRAND_NAVY }}>تسجيل الدخول</h1>
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 12, textAlign: "center" }}>مرحبًا بعودتك — أدخل بياناتك للمتابعة</p>
        <label style={lbl}>البريد الإلكتروني</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inp} />
        <label style={lbl}>كلمة المرور</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inp} />
        <button type="submit" disabled={loading} style={btn}>{loading ? "..." : "دخول"}</button>

        <div style={{ marginTop: 10, textAlign: "left" }}>
          <button
            type="button"
            onClick={() => setView("forgot")}
            style={{ background: "transparent", border: 0, color: "#2563eb", cursor: "pointer", fontSize: 13, padding: 0 }}
          >
            نسيت كلمة المرور؟
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "16px 0", color: "#9ca3af", fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} /> أو <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
        </div>

        <button type="button" onClick={signInWithGoogle} style={{ ...btn, background: "#fff", color: "#111", border: "1px solid #e5e7eb" }}>
          الدخول بحساب Google
        </button>
        <p style={{ marginTop: 14, color: "#6b7280", fontSize: 12, textAlign: "center" }}>
          الحسابات بالدعوة فقط — لا يوجد تسجيل عام.
        </p>
      </form>
    </div>
  );
}

function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return toast.error("صيغة البريد غير صحيحة");
    }
    setBusy(true);
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    toast.success("إذا كان البريد مسجلاً، سيتم إرسال رابط إعادة التعيين");
    onBack();
  }

  return (
    <div dir="rtl" style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, marginBottom: 6 }}>إعادة تعيين كلمة المرور</h1>
        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13 }}>
          أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور
        </p>
        <label style={lbl}>البريد الإلكتروني</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus style={inp} />
        <button type="submit" disabled={busy} style={btn}>
          {busy ? "..." : "إرسال رابط إعادة التعيين"}
        </button>
        <button type="button" onClick={onBack} style={{ ...btn, background: "#fff", color: "#111", border: "1px solid #e5e7eb" }}>
          رجوع لتسجيل الدخول
        </button>
      </form>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", background: "linear-gradient(135deg,#f5f7fb 0%,#e8ecf4 100%)", padding: 16 };
const card: React.CSSProperties = { width: "100%", maxWidth: 420, background: "#fff", padding: 28, borderRadius: 16, boxShadow: "0 12px 40px rgba(15,27,61,.12)", borderTop: `4px solid ${BRAND_GOLD}` };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, marginTop: 12, color: "#334155", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, marginTop: 4 };
const btn: React.CSSProperties = { marginTop: 14, width: "100%", padding: "12px 16px", borderRadius: 10, background: BRAND_NAVY, color: "#fff", border: 0, fontWeight: 700, cursor: "pointer", letterSpacing: ".3px" };
