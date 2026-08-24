import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { isDashboardViewPermissionKey, normalizePermissionBranch, normalizePermissionsForLoad, normalizePermissionsForSave } from "@/lib/permissionKeys";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type SettingsPermissionKey = "users_manage" | "roles_manage" | "backups_manage" | "company_manage" | "system_tools" | "import_data" | "change_password";

async function loadCallerAccess(userId: string) {
  const sb = admin();
  const { data: profile, error } = await sb
    .from("profiles")
    .select("is_super_admin, permissions")
    .eq("id", userId)
    .maybeSingle();
  if (error || !profile) throw new Error("Forbidden: profile not found");
  return { sb, profile: profile as any, permissions: normalizePermissionsForLoad((profile as any).permissions ?? {}) };
}

async function ensureSettingsPermission(userId: string, subKey: SettingsPermissionKey) {
  const access = await loadCallerAccess(userId);
  if (access.profile.is_super_admin === true) return access;
  if (access.permissions?.settings?.[subKey] === true) return access;
  throw new Error(`Forbidden: settings.${subKey} permission required`);
}

async function ensureAnySettingsPermission(userId: string, subKeys: SettingsPermissionKey[]) {
  const access = await loadCallerAccess(userId);
  if (access.profile.is_super_admin === true) return access;
  if (subKeys.some((key) => access.permissions?.settings?.[key] === true)) return access;
  throw new Error("Forbidden: explicit settings permission required");
}

async function ensureSuperAdmin(userId: string) {
  const access = await loadCallerAccess(userId);
  if (access.profile.is_super_admin === true) return access;
  throw new Error("Forbidden: Super Admin access required");
}

const EDITABLE_PERMISSION_SECTIONS = new Set([
  "dashboard", "submissions", "executions", "accounts", "companies", "merchants",
  "currency_suppliers", "investors", "expenses", "service_pricing_manage",
  "service_price_search", "reports", "data_import", "audit_log_view",
  "net_profit_view", "profit_summary_view", "financial_position_view", "cash_box_settlement",
  "settings",
]);

const SETTINGS_PERMISSION_KEYS = new Set([
  "view", "users_manage", "roles_manage", "backups_manage", "company_manage",
  "system_tools", "import_data", "change_password",
]);

function normalizePermissionSection(sectionKey: string, value: unknown): any {
  if (!EDITABLE_PERMISSION_SECTIONS.has(sectionKey)) throw new Error("Invalid permission section");
  if (isDashboardViewPermissionKey(sectionKey)) return value === true;
  if (sectionKey === "settings") {
    const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const out: Record<string, boolean> = {};
    for (const key of SETTINGS_PERMISSION_KEYS) out[key] = input[key] === true;
    if (Array.from(SETTINGS_PERMISSION_KEYS).some((key) => key !== "view" && out[key])) out.view = true;
    return out;
  }
  return normalizePermissionBranch(value);
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAnySettingsPermission(context.userId, ["users_manage", "roles_manage"]);
    const sb = admin();
    const { data: list } = await sb.auth.admin.listUsers();
    const { data: profiles } = await sb.from("profiles").select("*");
    const { data: roles } = await sb.from("user_roles").select("*");
    const users = (list?.users ?? []).map((u) => {
      const profile: any = profiles?.find((p: any) => p.id === u.id);
      const userRoles = roles?.filter((r) => r.user_id === u.id).map((r) => r.role) ?? [];
      return {
        id: u.id,
        email: u.email,
        full_name: profile?.full_name ?? u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        invited_at: u.invited_at,
        confirmed_at: u.confirmed_at,
        is_active: profile?.is_active ?? true,
        is_super_admin: profile?.is_super_admin ?? false,
        agent_id: profile?.agent_id ?? null,
        permissions: normalizePermissionsForLoad(profile?.permissions ?? {}),
        roles: userRoles,
      };
    });
    return { users };
  });

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    email: string;
    full_name: string;
    role: "admin" | "manager" | "user";
    agent_id?: string | null;
    permissions?: Record<string, any>;
    origin?: string;
  }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();

    const origin = data.origin || process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/accept-invite` : undefined;

    const { data: invited, error } = await sb.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.full_name, invited_by: context.userId },
      ...(redirectTo ? { redirectTo } : {}),
    });
    if (error) {
      console.error("[inviteUser] provider error:", error);
      // Surface the real reason (e.g. "User already registered", SMTP/domain issues)
      throw new Error(error.message || "فشل إرسال الدعوة من مزود البريد");
    }
    if (!invited?.user?.id) {
      throw new Error("لم يتمكن النظام من تأكيد إرسال الدعوة — تحقق من إعدادات نطاق البريد");
    }
    const userId = invited.user.id;

    await sb.from("profiles").upsert({
      id: userId,
      email: data.email,
      full_name: data.full_name,
      is_active: false,
      invite_accepted: false,
      agent_id: data.agent_id ?? null,
      permissions: normalizePermissionsForSave(data.permissions ?? {}),
      invited_by: context.userId,
    });
    await sb.from("user_roles").delete().eq("user_id", userId);
    await sb.from("user_roles").insert({ user_id: userId, role: data.role });
    return { id: userId, email: data.email };
  });

// Create a user directly without sending an invitation email.
// Generates a secure temporary password and returns it to the admin caller
// so it can be communicated to the user out-of-band.
export const createUserDirect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    email: string;
    full_name: string;
    role: "admin" | "manager" | "user";
    agent_id?: string | null;
    permissions?: Record<string, any>;
    password?: string;
  }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();

    function genPassword() {
      const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      let out = "";
      for (let i = 0; i < bytes.length; i++) out += charset[bytes[i] % charset.length];
      return out;
    }

    const password = (data.password && data.password.length >= 8) ? data.password : genPassword();

    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: data.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, created_by: context.userId },
    });
    if (createErr || !created?.user?.id) {
      throw new Error(createErr?.message || "فشل إنشاء حساب الدخول");
    }
    const userId = created.user.id;

    // If profile/role creation fails, roll back the auth user to avoid orphans.
    try {
      const { error: profileErr } = await sb.from("profiles").upsert({
        id: userId,
        email: data.email,
        full_name: data.full_name,
        is_active: true,
        invite_accepted: true,
        agent_id: data.agent_id ?? null,
        permissions: normalizePermissionsForSave(data.permissions ?? {}),
        invited_by: context.userId,
      });
      if (profileErr) throw new Error(profileErr.message || "تعذر إنشاء ملف المستخدم");

      const { error: delRoleErr } = await sb.from("user_roles").delete().eq("user_id", userId);
      if (delRoleErr) throw new Error(delRoleErr.message || "تعذر تهيئة صلاحيات الدور");

      const { error: roleErr } = await sb.from("user_roles").insert({ user_id: userId, role: data.role });
      if (roleErr) throw new Error(roleErr.message || "تعذر تعيين دور المستخدم");

      // Verify everything landed before reporting success.
      const { data: verify } = await sb
        .from("profiles")
        .select("id, is_active, invite_accepted")
        .eq("id", userId)
        .maybeSingle();
      const { data: verifyRole } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      if (!verify || !verifyRole) throw new Error("تعذر التحقق من إنشاء المستخدم بالكامل");
    } catch (err: any) {
      // Roll back the orphaned auth user so retries work cleanly.
      try { await sb.auth.admin.deleteUser(userId); } catch {}
      throw new Error(err?.message || "فشل إنشاء المستخدم");
    }

    return { id: userId, email: data.email, password };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; origin?: string }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();
    const origin = data.origin || process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/accept-invite` : undefined;
    const { error } = await sb.auth.admin.inviteUserByEmail(
      data.email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (error) {
      console.error("[resendInvite] provider error:", error);
      throw new Error(error.message || "فشل إرسال الدعوة من مزود البريد");
    }
    return { ok: true };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; origin?: string }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();
    const origin = data.origin || process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/reset-password` : undefined;
    await sb.auth.resetPasswordForEmail(
      data.email,
      redirectTo ? { redirectTo } : undefined,
    );
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();
    await sb.auth.admin.deleteUser(data.id);
    return { ok: true };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; is_active: boolean }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();
    await sb.from("profiles").update({ is_active: data.is_active }).eq("id", data.id);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; role: "admin" | "manager" | "user" }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "roles_manage");
    const sb = admin();
    await sb.from("user_roles").delete().eq("user_id", data.user_id);
    await sb.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    return { ok: true };
  });

export const updateUserPermissionSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; section_key: string; value: unknown }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "roles_manage");
    const sb = admin();
    const nextValue = normalizePermissionSection(data.section_key, data.value);
    const { data: savedPermissions, error } = await (sb as any).rpc(
      "update_profile_permission_section",
      {
        p_user_id: data.id,
        p_section_key: data.section_key,
        p_value: nextValue,
      },
    );
    if (error) throw new Error(error.message || "تعذر حفظ صلاحية المستخدم");
    if (!savedPermissions) throw new Error("لم يتم العثور على المستخدم المطلوب تحديثه");
    const normalized = normalizePermissionsForLoad(savedPermissions as Record<string, any>);
    return {
      ok: true,
      section_key: data.section_key,
      section_value: normalized[data.section_key],
    };
  });

export const setUserSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; is_super_admin: boolean }) => d)
  .handler(async ({ context, data }) => {
    await ensureSuperAdmin(context.userId);
    if (context.userId === data.id && data.is_super_admin === false) {
      throw new Error("لا يمكن إلغاء صلاحية صاحب النظام عن الحساب المستخدم حاليًا");
    }
    const sb = admin();
    const { data: saved, error } = await sb
      .from("profiles")
      .update({ is_super_admin: data.is_super_admin })
      .eq("id", data.id)
      .select("id, is_super_admin")
      .maybeSingle();
    if (error) throw new Error(error.message || "تعذر تحديث صلاحية صاحب النظام");
    if (!saved) throw new Error("لم يتم العثور على المستخدم المطلوب تحديثه");
    return { ok: true, profile: saved };
  });

export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    full_name?: string;
    agent_id?: string | null;
  }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "users_manage");
    const sb = admin();
    const patch: any = {};
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.agent_id !== undefined) patch.agent_id = data.agent_id;
    if (Object.keys(patch).length === 0) throw new Error("لا توجد بيانات مستخدم قابلة للتحديث");
    const { data: saved, error } = await sb
      .from("profiles")
      .update(patch)
      .eq("id", data.id)
      .select("id, permissions, is_super_admin")
      .maybeSingle();
    if (error) throw new Error(error.message || "تعذر حفظ بيانات المستخدم");
    if (!saved) throw new Error("لم يتم العثور على المستخدم المطلوب تحديثه");
    return { ok: true, profile: { ...saved, permissions: normalizePermissionsForLoad((saved as any).permissions ?? {}) } };
  });

// Activates the invited user's profile (bypasses privilege-escalation trigger
// via admin client). Caller must be authenticated as the invited user.
export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    const { error } = await sb
      .from("profiles")
      .update({ is_active: true, invite_accepted: true })
      .eq("id", context.userId);
    if (error) throw new Error(error.message || "تعذر تفعيل الحساب");
    return { ok: true };
  });

// Verifies a Google-signed-in user is allowed (must have an active profile).
// If not, returns { allowed: false } and the client signs out.
export const checkAccessAllowed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = admin();
    const { data: profile } = await sb.from("profiles").select("is_active").eq("id", context.userId).maybeSingle();
    if (!profile) return { allowed: false, reason: "not_invited" as const };
    if (profile.is_active === false) return { allowed: false, reason: "disabled" as const };
    return { allowed: true as const };
  });
