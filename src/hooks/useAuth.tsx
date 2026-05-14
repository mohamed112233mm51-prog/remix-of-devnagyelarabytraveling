import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Role = "admin" | "manager" | "user";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  profileLoaded: boolean;
  roles: Role[];
  isAdmin: boolean;
  needsPassword: boolean;
  blocked: null | "not_invited" | "disabled";
  permissions: Record<string, any>;
  setPasswordDone: () => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Record<string, any>>({});
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [blocked, setBlocked] = useState<null | "not_invited" | "disabled">(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY" || (s?.user && (s.user as any).recovery_sent_at && !s.user.last_sign_in_at)) {
        setNeedsPassword(true);
      }
      // detect invite: user has app_metadata.provider invite OR no last_sign_in
      if (s?.user) {
        const u: any = s.user;
        if (u.invited_at && !u.last_sign_in_at) setNeedsPassword(true);
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setRoles([]);
        setPermissions({});
        setBlocked(null);
        setNeedsPassword(false);
        setProfileLoaded(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        const u: any = data.session.user;
        if (u.invited_at && !u.last_sign_in_at) setNeedsPassword(true);
        loadProfile(data.session.user.id);
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Realtime: subscribe to current user's profile; sign out if disabled
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const channel = supabase
      .channel(`profile-watch-${uid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        (payload) => {
          const next: any = payload.new;
          if (next && (next.is_active === false || next.invite_accepted === false)) {
            toast.error("تم تعطيل حسابك بواسطة الإدارة");
            supabase.auth.signOut();
            return;
          }
          if (next && next.permissions) {
            setPermissions(next.permissions as Record<string, any>);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  async function loadProfile(uid: string) {
    try {
      const [{ data: roleRows, error: roleError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("profiles").select("is_active, invite_accepted, permissions").eq("id", uid).maybeSingle(),
      ]);
      if (roleError || profileError) {
        toast.error(roleError?.message || profileError?.message || "تعذر تحميل صلاحيات المستخدم");
        setRoles([]);
        setPermissions({});
        setBlocked(null);
        return;
      }
      setRoles((roleRows ?? []).map((r: any) => r.role));
      setPermissions(((profile as any)?.permissions as Record<string, any>) ?? {});
      if (!profile) setBlocked("not_invited");
      else if ((profile as any).is_active === false) setBlocked("disabled");
      else if ((profile as any).invite_accepted === false) setBlocked("disabled");
      else setBlocked(null);
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحميل صلاحيات المستخدم");
      setRoles([]);
      setPermissions({});
      setBlocked(null);
    } finally {
      setProfileLoaded(true);
    }
  }

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    loading,
    profileLoaded,
    roles,
    isAdmin: roles.includes("admin"),
    needsPassword,
    blocked,
    permissions,
    setPasswordDone: () => setNeedsPassword(false),
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? { error: error.message } : {};
    },
    signInWithGoogle: async () => {
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    },
    signOut: async () => {
      await supabase.auth.signOut();
      setRoles([]);
      setPermissions({});
      setBlocked(null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
