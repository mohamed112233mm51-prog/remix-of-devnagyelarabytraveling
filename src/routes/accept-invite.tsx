import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { acceptInvite as acceptInviteFn } from "@/lib/admin.functions";
import { getBranding, BRAND_NAVY, BRAND_GOLD } from "@/lib/branding";

export const Route = createFileRoute("/accept-invite")({
  component: AcceptInvitePage,
});

type InviteLinkData = {
  accessToken?: string;
  refreshToken?: string;
  tokenHash?: string;
  otpType?: string;
  code?: string;
  urlError?: string;
};

const inviteOtpTypes = ["invite", "recovery", "signup", "magiclink", "email"] as const;
function isInviteOtpType(type?: string): type is (typeof inviteOtpTypes)[number] {
  return !!type && inviteOtpTypes.includes(type as (typeof inviteOtpTypes)[number]);
}

function parseInviteLink(): InviteLinkData {
  const url = new URL(window.location.href);
  const hashParams = window.location.hash
    ? new URLSearchParams(window.location.hash.replace(/^#/, ""))
    : new URLSearchParams();
  const otpType = (url.searchParams.get("type") || hashParams.get("type") || "").toLowerCase();
  return {
    accessToken: hashParams.get("access_token") || undefined,
    refreshToken: hashParams.get("refresh_token") || undefined,
    tokenHash: url.searchParams.get("token_hash") || url.searchParams.get("token") || undefined,
    otpType: otpType || undefined,
    code: url.searchParams.get("code") || undefined,
    urlError:
      url.searchParams.get("error_description") ||
      url.searchParams.get("error") ||
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      undefined,
  };
}

function decodeEmailFromJwt(token?: string) {
  if (!token) return "";
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(normalized).split("").map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    const data = JSON.parse(json);
    return typeof data.email === "string" ? data.email : "";
  } catch {
    return "";
  }
}

function AcceptInvitePage() {
  const navigate = useNavigate();
  const { setPasswordDone } = useAuth();
  const acceptInvite = useServerFn(acceptInviteFn);
  const branding = getBranding();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const initRef = useRef(false);
  const submittingRef = useRef(false);
  const inviteLinkRef = useRef<InviteLinkData>({});

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const link = parseInviteLink();
    inviteLinkRef.current = link;

    if (link.urlError) {
      setLinkError("رابط الدعوة غير صالح أو انتهت صلاحيته");
      setReady(true);
      return;
    }

    const hasLinkToken = !!(link.accessToken || link.tokenHash || link.code);

    (async () => {
      let initialEmail = decodeEmailFromJwt(link.accessToken);
      if (!hasLinkToken) {
        const { data } = await supabase.auth.getSession();
        initialEmail = data.session?.user?.email || "";
        if (!data.session) {
          setLinkError("رابط الدعوة غير صالح أو انتهت صلاحيته");
        }
      }
      setEmail(initialEmail);
      setReady(true);
      if (window.location.search || window.location.hash) {
        window.history.replaceState(null, "", "/accept-invite");
      }
    })();
  }, []);

  async function ensureInviteSession() {
    const link = inviteLinkRef.current;
    if (link.accessToken && link.refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      if (error || !data.user) throw new Error(error?.message || "تعذر تفعيل جلسة الدعوة");
      return data.user;
    }
    if (link.tokenHash && link.otpType) {
      if (!isInviteOtpType(link.otpType)) throw new Error("نوع رابط الدعوة غير مدعوم");
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: link.otpType,
      });
      if (error || !data.user) throw new Error(error?.message || "تعذر التحقق من رابط الدعوة");
      return data.user;
    }
    if (link.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);
      if (error || !data.user) throw new Error(error?.message || "تعذر تفعيل رابط الدعوة");
      return data.user;
    }
    const current = await supabase.auth.getSession();
    if (current.data.session?.user) return current.data.session.user;
    throw new Error("رابط الدعوة غير صالح أو انتهت صلاحيته");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || busy) return;
    setErr(null);
    if (pw.length < 8) { setErr("كلمة المرور 8 أحرف على الأقل"); return; }
    if (pw !== pw2) { setErr("كلمتا المرور غير متطابقتين"); return; }

    submittingRef.current = true;
    setBusy(true);
    try {
      await ensureInviteSession();
      const { error: updErr } = await supabase.auth.updateUser({ password: pw });
      if (updErr) throw new Error(updErr.message || "تعذر تعيين كلمة المرور");
      await acceptInvite();
      setSuccess(true);
      setPasswordDone();
      toast.success("تم تفعيل الحساب بنجاح");
      setTimeout(() => navigate({ to: "/" }), 900);
    } catch (error: any) {
      submittingRef.current = false;
      const message = error?.message || "رابط الدعوة غير صالح أو انتهت صلاحيته";
      setErr(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const wrap: React.CSSProperties = {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(135deg, #F8FAFC 0%, #E0F2FE 100%)",
    padding: 16,
    fontFamily: "'Cairo','Tajawal',sans-serif",
  };
  const card: React.CSSProperties = {
    width: "100%", maxWidth: 440, background: "#fff",
    padding: "32px 28px", borderRadius: 16,
    boxShadow: "0 12px 40px rgba(15,23,42,0.12)",
    border: "1px solid #E2E8F0",
  };
  const lbl: React.CSSProperties = {
    display: "block", fontSize: 13, fontWeight: 700, marginTop: 14,
    marginBottom: 6, color: "#475569",
  };
  const inp: React.CSSProperties = {
    width: "100%", padding: "11px 14px", borderRadius: 10,
    border: "1px solid #E2E8F0", fontSize: 14, outline: "none",
    background: "#F8FAFC", color: "#1E293B",
    fontFamily: "inherit",
  };
  const btn: React.CSSProperties = {
    marginTop: 22, width: "100%", padding: "13px 16px", borderRadius: 10,
    background: `linear-gradient(135deg, ${BRAND_GOLD} 0%, #B8941F 100%)`,
    color: "#fff", border: 0, fontWeight: 800, fontSize: 15,
    cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
    boxShadow: "0 4px 14px rgba(201,168,76,0.35)",
    fontFamily: "inherit",
  };

  if (!ready) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={{ ...card, textAlign: "center", color: "#64748B" }}>جارِ تجهيز الصفحة...</div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={wrap}>
      <form onSubmit={submit} style={card}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          {branding.logoUrl && (
            <img
              src={branding.logoUrl}
              alt="Logo"
              style={{ width: 64, height: 64, objectFit: "contain", margin: "0 auto 10px" }}
            />
          )}
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: BRAND_NAVY }}>
            تفعيل حسابك
          </h1>
          <p style={{ marginTop: 6, color: "#64748B", fontSize: 13 }}>
            مرحباً بك في {branding.companyName || "النظام"} — أنشئ كلمة مرور لحسابك للمتابعة
          </p>
        </div>

        {linkError && (
          <div style={{
            padding: 12, borderRadius: 10, background: "#FEE2E2",
            border: "1px solid #FCA5A5", color: "#991B1B",
            fontSize: 13, fontWeight: 700, textAlign: "center",
          }}>
            {linkError}
          </div>
        )}

        {success && (
          <div style={{
            padding: 12, borderRadius: 10, background: "#DCFCE7",
            border: "1px solid #86EFAC", color: "#14532D",
            fontSize: 13, fontWeight: 700, textAlign: "center",
          }}>
            ✓ تم تفعيل الحساب بنجاح — جارِ التحويل...
          </div>
        )}

        {!linkError && !success && (
          <>
            {err && (
              <div style={{
                padding: 10, borderRadius: 8, background: "#FEE2E2",
                border: "1px solid #FCA5A5", color: "#991B1B",
                fontSize: 13, fontWeight: 700, marginTop: 4,
              }}>
                {err}
              </div>
            )}

            <label style={lbl}>البريد الإلكتروني</label>
            <input
              value={email || "—"}
              readOnly
              style={{ ...inp, background: "#F1F5F9", color: "#64748B", cursor: "not-allowed" }}
            />

            <label style={lbl}>كلمة المرور الجديدة</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              autoFocus
              minLength={8}
              placeholder="٨ أحرف على الأقل"
              style={inp}
            />

            <label style={lbl}>تأكيد كلمة المرور</label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
              minLength={8}
              placeholder="أعد إدخال كلمة المرور"
              style={inp}
            />

            <button type="submit" disabled={busy} style={btn}>
              {busy ? "جارِ التفعيل..." : "تفعيل الحساب"}
            </button>
          </>
        )}

        {linkError && (
          <button
            type="button"
            onClick={() => navigate({ to: "/" })}
            style={{ ...btn, background: BRAND_NAVY, boxShadow: "none" }}
          >
            العودة لتسجيل الدخول
          </button>
        )}
      </form>
    </div>
  );
}
