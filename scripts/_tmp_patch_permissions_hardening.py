from pathlib import Path

# --- server authorization hardening ---
admin_path = Path('src/lib/admin.functions.ts')
text = admin_path.read_text(encoding='utf-8')
text = text.replace(
'import { normalizePermissionsForLoad, normalizePermissionsForSave } from "@/lib/permissionKeys";',
'import { isDashboardViewPermissionKey, normalizePermissionBranch, normalizePermissionsForLoad, normalizePermissionsForSave } from "@/lib/permissionKeys";'
)
old_guard = '''async function ensureAdmin(_supabase: any, userId: string, subKey: string = "users_manage") {
  const sb = admin();
  const { data: profile } = await sb
    .from("profiles")
    .select("is_super_admin, permissions")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.is_super_admin) return;
  const perms: any = profile?.permissions ?? {};
  if (perms?.settings?.[subKey] === true || perms?.settings?.view === true) return;
  const { data: roleRow } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleRow) return;
  throw new Error("Forbidden: admin access required");
}
'''
new_guard = '''type SettingsPermissionKey = "users_manage" | "roles_manage" | "backups_manage" | "company_manage" | "system_tools" | "import_data" | "change_password";

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
'''
if old_guard not in text:
    raise SystemExit('ensureAdmin block not found')
text = text.replace(old_guard, new_guard)

# Explicit server-side authorization per operation.
text = text.replace('await ensureAdmin(context.supabase, context.userId);', 'await ensureAnySettingsPermission(context.userId, ["users_manage", "roles_manage"]);', 1)
for _ in range(6):
    text = text.replace('await ensureAdmin(context.supabase, context.userId);', 'await ensureSettingsPermission(context.userId, "users_manage");', 1)
# setUserRole is the next remaining ensureAdmin call.
text = text.replace('await ensureAdmin(context.supabase, context.userId);', 'await ensureSettingsPermission(context.userId, "roles_manage");', 1)

old_update = '''export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    full_name?: string;
    agent_id?: string | null;
    permissions?: Record<string, any>;
    is_super_admin?: boolean;
  }) => d)
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const sb = admin();
    const patch: any = {};
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.agent_id !== undefined) patch.agent_id = data.agent_id;
    if (data.permissions !== undefined) patch.permissions = normalizePermissionsForSave(data.permissions);
    if (data.is_super_admin !== undefined) patch.is_super_admin = data.is_super_admin;
    const { data: saved, error } = await sb
      .from("profiles")
      .update(patch)
      .eq("id", data.id)
      .select("id, permissions, is_super_admin")
      .maybeSingle();
    if (error) throw new Error(error.message || "تعذر حفظ صلاحيات المستخدم");
    if (!saved) throw new Error("لم يتم العثور على المستخدم المطلوب تحديثه");
    return { ok: true, profile: { ...saved, permissions: normalizePermissionsForLoad((saved as any).permissions ?? {}) } };
  });
'''
new_update = '''export const updateUserPermissionSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; section_key: string; value: unknown }) => d)
  .handler(async ({ context, data }) => {
    await ensureSettingsPermission(context.userId, "roles_manage");
    const sb = admin();
    const { data: current, error: readError } = await sb
      .from("profiles")
      .select("permissions")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message || "تعذر قراءة صلاحيات المستخدم");
    if (!current) throw new Error("لم يتم العثور على المستخدم المطلوب تحديثه");

    const currentPermissions = normalizePermissionsForLoad((current as any).permissions ?? {});
    const nextValue = normalizePermissionSection(data.section_key, data.value);
    const nextPermissions = normalizePermissionsForSave({ ...currentPermissions, [data.section_key]: nextValue });
    const { data: saved, error } = await sb
      .from("profiles")
      .update({ permissions: nextPermissions })
      .eq("id", data.id)
      .select("id, permissions, is_super_admin")
      .maybeSingle();
    if (error) throw new Error(error.message || "تعذر حفظ صلاحية المستخدم");
    if (!saved) throw new Error("لم يتم العثور على المستخدم المطلوب تحديثه");
    return {
      ok: true,
      section_key: data.section_key,
      section_value: normalizePermissionsForLoad((saved as any).permissions ?? {})[data.section_key],
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
'''
if old_update not in text:
    raise SystemExit('updateUserProfile block not found')
text = text.replace(old_update, new_update)
if 'ensureAdmin(' in text:
    raise SystemExit('legacy ensureAdmin call remains')
admin_path.write_text(text, encoding='utf-8')

# --- settings UI: send only the changed permission section ---
settings_path = Path('src/routes/settings.tsx')
s = settings_path.read_text(encoding='utf-8')
s = s.replace(
'''  createBackup, listBackups, downloadBackup, deleteBackup, restoreBackup, previewBackup, runRetentionNow, importBackup,
} from "@/lib/backups.functions";''',
'''  createBackup, listBackups, downloadBackup, deleteBackup, restoreBackup, previewBackup, runRetentionNow, importBackup,
} from "@/lib/backups.functions";'''
)
s = s.replace(
'''  listUsers, inviteUser, createUserDirect, deleteUser, setUserRole,
  setUserActive, updateUserProfile, resendInvite, sendPasswordReset,
} from "@/lib/admin.functions";''',
'''  listUsers, inviteUser, createUserDirect, deleteUser, setUserRole,
  setUserActive, updateUserProfile, updateUserPermissionSection, setUserSuperAdmin,
  resendInvite, sendPasswordReset,
} from "@/lib/admin.functions";'''
)
old_init = '''  const setRoleFn = useServerFn(setUserRole);
  const updFn = useServerFn(updateUserProfile);
  const { user: currentAuthUser, refreshProfile } = useAuth();
  const qc = useQueryClient();'''
new_init = '''  const setRoleFn = useServerFn(setUserRole);
  const updFn = useServerFn(updateUserProfile);
  const updatePermissionFn = useServerFn(updateUserPermissionSection);
  const setSuperAdminFn = useServerFn(setUserSuperAdmin);
  const { user: currentAuthUser, isSuperAdmin: currentIsSuperAdmin, refreshProfile } = useAuth();
  const qc = useQueryClient();
  const permissionCommitQueue = React.useRef<Promise<void>>(Promise.resolve());'''
if old_init not in s:
    raise SystemExit('PermsUserCard init block not found')
s = s.replace(old_init, new_init)

old_commit = '''  const commit = async (sectionKey: string, next: Record<string, boolean> | boolean) => {
    const previous = draftPermissions;
    const merged = { ...(draftPermissions || {}), [sectionKey]: next };
    setDraftPermissions(merged);
    try {
      const result: any = await updFn({ data: { id: u.id, permissions: merged } });
      const savedPermissions = result?.profile?.permissions ?? merged;
      setDraftPermissions(savedPermissions);
      qc.removeQueries({ queryKey: ["dashboard-net-profit"] });
      qc.removeQueries({ queryKey: ["dashboard-profit-summary"] });
      qc.removeQueries({ queryKey: ["dashboard-profit"] });
      if (currentAuthUser?.id === u.id) {
        await refreshProfile();
      }
      await onChanged();
      toast.success("تم حفظ الصلاحيات");
    } catch (err: any) {
      setDraftPermissions(previous);
      toast.error(err?.message || "تعذر حفظ الصلاحيات");
    }
  };'''
new_commit = '''  const commit = async (sectionKey: string, next: Record<string, boolean> | boolean) => {
    const previousSection = draftPermissions?.[sectionKey];
    setDraftPermissions((current) => ({ ...(current || {}), [sectionKey]: next }));

    const saveOneSection = async () => {
      try {
        const result: any = await updatePermissionFn({ data: { id: u.id, section_key: sectionKey, value: next } });
        setDraftPermissions((current) => ({
          ...(current || {}),
          [sectionKey]: result?.section_value ?? next,
        }));
        qc.removeQueries({ queryKey: ["dashboard-net-profit"] });
        qc.removeQueries({ queryKey: ["dashboard-profit-summary"] });
        qc.removeQueries({ queryKey: ["dashboard-profit"] });
        if (currentAuthUser?.id === u.id) await refreshProfile();
        toast.success("تم حفظ الصلاحية");
      } catch (err: any) {
        setDraftPermissions((current) => ({ ...(current || {}), [sectionKey]: previousSection }));
        toast.error(err?.message || "تعذر حفظ الصلاحية");
        throw err;
      }
    };

    permissionCommitQueue.current = permissionCommitQueue.current.catch(() => undefined).then(saveOneSection);
    try {
      await permissionCommitQueue.current;
      await onChanged();
    } catch {}
  };'''
if old_commit not in s:
    raise SystemExit('permission commit block not found')
s = s.replace(old_commit, new_commit)

s = s.replace(
'await updFn({ data: { id: u.id, is_super_admin: nextVal } });',
'await setSuperAdminFn({ data: { id: u.id, is_super_admin: nextVal } });'
)
s = s.replace(
'''                  checked={draftSuperAdmin}
                  onChange={async (e) => {''',
'''                  checked={draftSuperAdmin}
                  disabled={!currentIsSuperAdmin}
                  onChange={async (e) => {''',
1
)
s = s.replace(
'''                تفعيل (يتجاوز جميع صلاحيات الإعدادات)
              </label>''',
'''                {currentIsSuperAdmin ? "تفعيل (يتجاوز جميع صلاحيات الإعدادات)" : "Super Admin فقط يمكنه تغيير هذا الخيار"}
              </label>''',
1
)
settings_path.write_text(s, encoding='utf-8')

print('permissions hardening patch applied')
