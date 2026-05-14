import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    function settle(ok: boolean) {
      if (cancelled || settled) return;
      settled = true;
      setHasSession(ok);
      setReady(true);
    }

    // Listen for PASSWORD_RECOVERY / SIGNED_IN events fired after Supabase
    // parses the recovery tokens from the URL hash.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED"))) {
        settle(true);
      }
    });

    // Also poll getSession a few times in case the event already fired
    (async () => {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const hasRecoveryHash = hash.includes("access_token") || hash.includes("type=recovery") || hash.includes("code=");

      for (let i = 0; i < 20; i++) {
        if (cancelled || settled) return;
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) return settle(true);
        await new Promise((r) => setTimeout(r, 150));
      }
      // timed out
      if (!hasRecoveryHash) settle(false);
      else settle(false);
    })();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return toast.error("كلمة المرور 8 أحرف على الأقل");
    if (pw !== pw2) return toast.error("كلمتا المرور غير متطابقتين");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    await supabase.auth.signOut();
    setBusy(false);
    toast.success("تم تغيير كلمة المرور بنجاح");
    navigate({ to: "/" });
  }

  if (!ready) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={card}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>جارٍ التحقق من الرابط...</h1>
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={card}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#dc2626" }}>رابط غير صالح</h1>
          <p style={{ marginTop: 10, color: "#374151", fontSize: 14 }}>رابط إعادة التعيين غير صالح أو منتهي الصلاحية</p>
          <button onClick={() => navigate({ to: "/" })} style={btn}>الذهاب لتسجيل الدخول</button>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>تعيين كلمة مرور جديدة</h1>
        <label style={lbl}>كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required style={inp} />
        <label style={lbl}>تأكيد كلمة المرور</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required style={inp} />
        <button type="submit" disabled={busy} style={btn}>{busy ? "..." : "حفظ كلمة المرور"}</button>
      </form>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fb", padding: 16 };
const card: React.CSSProperties = { width: "100%", maxWidth: 420, background: "#fff", padding: 28, borderRadius: 16, boxShadow: "0 8px 30px rgba(0,0,0,.08)" };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, marginTop: 12 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, marginTop: 4 };
const btn: React.CSSProperties = { marginTop: 18, width: "100%", padding: "12px 16px", borderRadius: 10, background: "#2563eb", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" };
