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
      if (
        event === "PASSWORD_RECOVERY" ||
        (s?.user && (s.user as any).recovery_sent_at && !s.user.last_sign_in_at)
      ) {
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

  // Realtime: subscribe to current user's profile + roles; sign out if disabled
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const isAcceptInviteRoute =
      typeof window !== "undefined" && window.location.pathname === "/accept-invite";
    if (isAcceptInviteRoute) return;

    const handleDisabled = async () => {
      toast.error("تم تعطيل حسابك بواسطة الإدارة");
      try {
        if (typeof window !== "undefined") {
          localStorage.clear();
          sessionStorage.clear();
        }
      } catch {}
      await supabase.auth.signOut();
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    };

    const channel = supabase
      .channel(`user-watch-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        (payload) => {
          const next: any = (payload as any).new;
          if (payload.eventType === "DELETE") {
            handleDisabled();
            return;
          }
          if (next && (next.is_active === false || next.invite_accepted === false)) {
            handleDisabled();
            return;
          }
          if (next && next.is_active !== false && next.invite_accepted !== false) {
            setBlocked(null);
          }
          if (next && next.permissions) {
            setPermissions(next.permissions as Record<string, any>);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${uid}` },
        () => {
          loadProfile(uid);
        },
      )
      .subscribe();

    // Polling fallback every 8s in case realtime drops
    const poll = setInterval(async () => {
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("is_active, invite_accepted, permissions")
          .eq("id", uid)
          .maybeSingle();
        if (error) return;
        if (
          !profile ||
          (profile as any).is_active === false ||
          (profile as any).invite_accepted === false
        ) {
          handleDisabled();
          return;
        }
        setBlocked(null);
        const nextPerms = ((profile as any).permissions ?? {}) as Record<string, any>;
        setPermissions((prev) =>
          JSON.stringify(prev) === JSON.stringify(nextPerms) ? prev : nextPerms,
        );
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid);
        const nextRoles = (roleRows ?? []).map((r: any) => r.role) as Role[];
        setRoles((prev) =>
          prev.length === nextRoles.length && prev.every((r) => nextRoles.includes(r))
            ? prev
            : nextRoles,
        );
      } catch {}
    }, 8000);

    // Multi-tab: react to logout in other tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("sb-") && e.newValue === null) {
        if (typeof window !== "undefined") window.location.href = "/";
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, [session?.user?.id]);

  async function loadProfile(uid: string) {
    try {
      const [{ data: roleRows, error: roleError }, { data: profile, error: profileError }] =
        await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", uid),
          supabase
            .from("profiles")
            .select("is_active, invite_accepted, permissions")
            .eq("id", uid)
            .maybeSingle(),
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
    setPasswordDone: () => {
      setNeedsPassword(false);
      setBlocked(null);
      if (session?.user?.id) loadProfile(session.user.id);
    },
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
