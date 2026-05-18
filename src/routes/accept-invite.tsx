import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

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

type InviteInitResult = {
  ready: boolean;
  email: string;
  userId: string | null;
  link: InviteLinkData;
};

const inviteInitCache = new Map<string, InviteInitResult>();

function getCacheKey() {
  if (typeof window === "undefined") return "/accept-invite";
  const href = window.location.href;
  return href.includes("access_token") || href.includes("token_hash") || href.includes("code=") || href.includes("type=invite")
    ? href
    : "/accept-invite";
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
      atob(normalized)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
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
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasProcessedInviteRef = useRef(false);
  const hasSubmittedInviteRef = useRef(false);
  const inviteLinkRef = useRef<InviteLinkData>({});

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (hasProcessedInviteRef.current) return;
      hasProcessedInviteRef.current = true;

      const cacheKey = getCacheKey();
      const cached = inviteInitCache.get(cacheKey) ?? inviteInitCache.get("/accept-invite");
      if (cached) {
        inviteLinkRef.current = cached.link;
        setEmail(cached.email);
        setReady(cached.ready);
        return;
      }

      const link = parseInviteLink();
      inviteLinkRef.current = link;

      // Do not verify or consume token_hash/code on page open. For hash links,
      // decode the visible email from the token and wait for the user submit.
      const shouldReadExistingSession = !link.accessToken && !link.tokenHash && !link.code;
      const { data } = shouldReadExistingSession
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      if (cancelled) return;

      const initialEmail = decodeEmailFromJwt(link.accessToken) || data.session?.user?.email || "";
      const result: InviteInitResult = {
        ready: true,
        email: initialEmail,
        userId: data.session?.user?.id ?? null,
        link,
      };
      inviteInitCache.set(cacheKey, result);
      inviteInitCache.set("/accept-invite", result);

      setEmail(initialEmail);
      setReady(true);

      if (window.location.search || window.location.hash) {
        window.history.replaceState(null, "", "/accept-invite");
      }
    }
    init().catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureInviteSession() {
    const current = await supabase.auth.getSession();
    if (current.data.session?.user) return current.data.session.user;

    const link = inviteLinkRef.current;
    if (link.urlError) throw new Error("رابط الدعوة غير صالح أو منتهي الصلاحية");

    if (link.accessToken && link.refreshToken) {
      const { data, error } = await supabase.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      if (error || !data.user) throw new Error(error?.message || "تعذر تفعيل جلسة الدعوة");
      return data.user;
    }

    if (link.tokenHash && link.otpType) {
      const allowedTypes = ["invite", "recovery", "signup", "magiclink", "email"];
      if (!allowedTypes.includes(link.otpType)) throw new Error("نوع رابط الدعوة غير مدعوم");
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: link.tokenHash,
        type: link.otpType as any,
      });
      if (error || !data.user) throw new Error(error?.message || "تعذر التحقق من رابط الدعوة");
      return data.user;
    }

    if (link.code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);
      if (error || !data.user) throw new Error(error?.message || "تعذر تفعيل رابط الدعوة");
      return data.user;
    }

    throw new Error("رابط الدعوة غير صالح أو منتهي الصلاحية");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (hasSubmittedInviteRef.current || busy) return;
    if (pw.length < 8) return toast.error("كلمة المرور 8 أحرف على الأقل");
    if (pw !== pw2) return toast.error("كلمتا المرور غير متطابقتين");

    hasSubmittedInviteRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      await ensureInviteSession();
      const { data: userData, error: updErr } = await supabase.auth.updateUser({ password: pw });
      if (updErr || !userData.user) throw new Error(updErr?.message ?? "تعذر تعيين كلمة المرور");

      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ is_active: true, invite_accepted: true })
        .eq("id", userData.user.id);
      if (profileErr) throw new Error(profileErr.message || "تعذر تفعيل الحساب");

      setPasswordDone();
      toast.success("تم تفعيل الحساب بنجاح");
      navigate({ to: "/" });
    } catch (error: any) {
      hasSubmittedInviteRef.current = false;
      const message = error?.message || "رابط الدعوة غير صالح أو منتهي الصلاحية";
      setErr(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div dir="rtl" style={wrap}>
        <div style={card}>جارِ تجهيز نموذج تفعيل الحساب...</div>
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
        {err && <p style={{ marginTop: 10, color: "#dc2626", fontSize: 13, fontWeight: 700 }}>{err}</p>}
        <label style={lbl}>البريد الإلكتروني</label>
        <input value={email || "سيتم تحديد البريد من رابط الدعوة"} readOnly style={{ ...inp, background: "#f3f4f6" }} />
        <label style={lbl}>كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus style={inp} />
        <label style={lbl}>تأكيد كلمة المرور</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required style={inp} />
        <button type="submit" disabled={busy} style={btn}>
          {busy ? "..." : "قبول الدعوة وتفعيل الحساب"}
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
