import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hasPermission, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, normalizePermissionsForLoad } from "@/lib/permissionKeys";

type Role = "admin" | "manager" | "user";

type AuthCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  profileLoaded: boolean;
  profileError: string | null;
  roles: Role[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  needsPassword: boolean;
  blocked: null | "not_invited" | "disabled";
  permissions: Record<string, any>;
  refreshProfile: () => Promise<void>;
  setPasswordDone: () => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
const STARTUP_TIMEOUT_MS = 8000;

function withStartupTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${STARTUP_TIMEOUT_MS}ms`)), STARTUP_TIMEOUT_MS);
    Promise.resolve(promise).then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Record<string, any>>({});
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [blocked, setBlocked] = useState<null | "not_invited" | "disabled">(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const safeLoadProfile = useCallback(async (uid: string, loader: (uid: string) => Promise<void>) => {
    try { setProfileError(null); await loader(uid); }
    catch (e: any) { setProfileError(e?.message || "تعذر تحميل صلاحيات المستخدم"); }
  }, []);

  const applyPermissions = useCallback((uid: string, nextPerms: Record<string, any>, nextIsSuperAdmin: boolean) => {
    const effectivePerms = normalizePermissionsForLoad(nextPerms);
    setPermissions((prev) =>
      JSON.stringify(prev) === JSON.stringify(effectivePerms) ? prev : effectivePerms,
    );
    if (import.meta.env.DEV) {
      console.debug("[permissions] loaded", {
        userId: uid,
        permissions: effectivePerms,
        isSystemOwner: nextIsSuperAdmin,
        hasNetProfitPermission: nextIsSuperAdmin || hasPermission(effectivePerms, NET_PROFIT_PERMISSION_KEY),
        hasProfitSummaryPermission: nextIsSuperAdmin || hasPermission(effectivePerms, PROFIT_SUMMARY_PERMISSION_KEY),
      });
    }
  }, []);

  const loadProfile = useCallback(async (uid: string) => {
    console.info("[startup] Profile/Permissions loading start");
    try {
      const [{ data: roleRows, error: roleError }, { data: profile, error: profileError }] =
        await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", uid),
          supabase
            .from("profiles")
            .select("is_active, invite_accepted, permissions, is_super_admin")
            .eq("id", uid)
            .maybeSingle(),
        ]);
      if (roleError || profileError) {
        throw new Error(roleError?.message || profileError?.message || "تعذر تحميل صلاحيات المستخدم");
      }
      const nextRoles = (roleRows ?? []).map((r: any) => r.role);
      const nextPerms = (((profile as any)?.permissions as Record<string, any>) ?? {});
      const nextIsSuperAdmin = !!(profile as any)?.is_super_admin;
      setRoles(nextRoles);
      setIsSuperAdmin(nextIsSuperAdmin);
      applyPermissions(uid, nextPerms, nextIsSuperAdmin);
      if (!profile) setBlocked("not_invited");
      else if ((profile as any).is_active === false) setBlocked("disabled");
      else if ((profile as any).invite_accepted === false) setBlocked("disabled");
      else setBlocked(null);
      setProfileLoaded(true);
      console.info("[startup] Profile/Permissions loading complete");
    } catch (error: any) {
      console.warn("[startup] Profile/Permissions failed", error);
      // Do NOT set profileLoaded=true on real errors — that would render an Unauthorized screen.
      // Leave profileLoaded=false so the UI shows the retry state via __root.
      throw error;
    }
  }, [applyPermissions]);

  const refreshProfile = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
    setProfileLoaded(false);
    await safeLoadProfile(uid, loadProfile);
  }, [loadProfile, safeLoadProfile, session?.user?.id]);

  useEffect(() => {
    console.info("[startup] Auth bootstrap start");
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      console.info("[startup] Auth state change", event, !!s?.user);
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
        setProfileLoaded(false);
        setTimeout(() => safeLoadProfile(s.user.id, loadProfile), 0);
      } else {
        setRoles([]);
        setPermissions({});
        setIsSuperAdmin(false);
        setBlocked(null);
        setNeedsPassword(false);
        setProfileLoaded(false);
      }
    });
    withStartupTimeout(supabase.auth.getSession(), "Auth")
      .then(({ data }) => {
        console.info("[startup] Auth bootstrap complete", !!data.session?.user);
        setSession(data.session);
        if (data.session?.user) {
          const u: any = data.session.user;
          if (u.invited_at && !u.last_sign_in_at) setNeedsPassword(true);
          setProfileLoaded(false);
          safeLoadProfile(data.session.user.id, loadProfile);
        }
      })
      .catch((error) => {
        console.warn("[startup] Auth bootstrap failed or timed out", error);
        setSession(null);
      })
      .finally(() => setLoading(false));
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

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
          if (next) {
            const nextPerms = ((next as any).permissions ?? {}) as Record<string, any>;
            const nextIsSuperAdmin = !!(next as any).is_super_admin;
            setIsSuperAdmin(nextIsSuperAdmin);
            applyPermissions(uid, nextPerms, nextIsSuperAdmin);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${uid}` },
        () => {
          safeLoadProfile(uid, loadProfile);
        },
      )
      .subscribe();

    // Polling fallback every 8s in case realtime drops
    const poll = setInterval(async () => {
      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("is_active, invite_accepted, permissions, is_super_admin")
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
        const nextIsSuperAdmin = !!(profile as any).is_super_admin;
        setIsSuperAdmin(nextIsSuperAdmin);
        const nextPerms = ((profile as any).permissions ?? {}) as Record<string, any>;
        applyPermissions(uid, nextPerms, nextIsSuperAdmin);
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
  }, [applyPermissions, loadProfile, session?.user?.id]);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    loading,
    profileLoaded,
    profileError,
    roles,
    isAdmin: roles.includes("admin") || isSuperAdmin,
    isSuperAdmin,
    needsPassword,
    blocked,
    permissions,
    refreshProfile,
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
      setIsSuperAdmin(false);
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
