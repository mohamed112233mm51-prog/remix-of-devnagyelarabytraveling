import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

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
    <div dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fb", padding: 16 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420, background: "#fff", padding: 28, borderRadius: 16, boxShadow: "0 8px 30px rgba(0,0,0,.08)" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>تعيين كلمة المرور</h1>
        <p style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>أهلاً {email} — أنشئ كلمة مرور لحسابك للمتابعة.</p>
        <label style={lbl}>كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required style={inp} />
        <label style={lbl}>تأكيد كلمة المرور</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required style={inp} />
        <button type="submit" disabled={busy} style={{ marginTop: 18, width: "100%", padding: "12px 16px", borderRadius: 10, background: "#2563eb", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}>
          {busy ? "..." : "حفظ والمتابعة"}
        </button>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 13, marginTop: 12 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, marginTop: 4 };
