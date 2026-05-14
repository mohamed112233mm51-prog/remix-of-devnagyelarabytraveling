import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/accept-invite")({
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Supabase parses the recovery/invite tokens from the URL hash automatically
    // and creates a session. We just wait for it.
    let cancelled = false;
    async function init() {
      // Give the client a tick to consume the hash
      await new Promise((r) => setTimeout(r, 50));
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session?.user) {
        setErr("رابط الدعوة غير صالح أو منتهي الصلاحية");
        setReady(true);
        return;
      }
      setEmail(data.session.user.email ?? "");
      setReady(true);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return toast.error("كلمة المرور 8 أحرف على الأقل");
    if (pw !== pw2) return toast.error("كلمتا المرور غير متطابقتين");
    setBusy(true);
    const { data: userData, error: updErr } = await supabase.auth.updateUser({ password: pw });
    if (updErr || !userData.user) {
      setBusy(false);
      return toast.error(updErr?.message ?? "تعذر تعيين كلمة المرور");
    }
    // Mark profile as accepted + active
    await supabase
      .from("profiles")
      .update({ is_active: true, invite_accepted: true })
      .eq("id", userData.user.id);

    await supabase.auth.signOut();
    setBusy(false);
    toast.success("تم تفعيل الحساب بنجاح، يمكنك تسجيل الدخول الآن");
    navigate({ to: "/" });
  }

  if (!ready) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={card}>جارِ التحقق من رابط الدعوة...</div>
      </div>
    );
  }

  if (err) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={card}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#dc2626" }}>رابط غير صالح</h1>
          <p style={{ marginTop: 10, color: "#374151", fontSize: 14 }}>{err}</p>
          <p style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>تواصل مع المسؤول لإعادة إرسال الدعوة.</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>تفعيل الحساب</h1>
        <p style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>
          أهلاً بك — أنشئ كلمة مرور لحسابك للمتابعة.
        </p>
        <label style={lbl}>البريد الإلكتروني</label>
        <input value={email} readOnly style={{ ...inp, background: "#f3f4f6" }} />
        <label style={lbl}>كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required style={inp} />
        <label style={lbl}>تأكيد كلمة المرور</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required style={inp} />
        <button type="submit" disabled={busy} style={btn}>
          {busy ? "..." : "إنشاء كلمة المرور وتفعيل الحساب"}
        </button>
      </form>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fb", padding: 16 };
const card: React.CSSProperties = { width: "100%", maxWidth: 420, background: "#fff", padding: 28, borderRadius: 16, boxShadow: "0 8px 30px rgba(0,0,0,.08)" };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, marginTop: 12 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, marginTop: 4 };
const btn: React.CSSProperties = { marginTop: 18, width: "100%", padding: "12px 16px", borderRadius: 10, background: "#2563eb", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" };
