from pathlib import Path

admin_path = Path('src/lib/admin.functions.ts')
text = admin_path.read_text(encoding='utf-8')
old = '''export const updateUserPermissionSection = createServerFn({ method: "POST" })
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
'''
new = '''export const updateUserPermissionSection = createServerFn({ method: "POST" })
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
'''
if old not in text:
    raise SystemExit('updateUserPermissionSection block not found')
admin_path.write_text(text.replace(old, new), encoding='utf-8')

migration_path = Path('supabase/migrations/20260824173500_settings_permission_rls_hardening.sql')
m = migration_path.read_text(encoding='utf-8')
marker = '''GRANT EXECUTE ON FUNCTION public.app_settings_permission_allowed(text) TO authenticated, service_role;
'''
if marker not in m:
    raise SystemExit('migration insertion marker not found')
addition = r'''

-- Atomic permission-section update. Only trusted backend service_role may call
-- this function. jsonb_set updates one top-level section without a read/merge/
-- rewrite race against another administrator editing a different section.
CREATE OR REPLACE FUNCTION public.update_profile_permission_section(
  p_user_id uuid,
  p_section_key text,
  p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permissions jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_REQUIRED';
  END IF;
  IF p_section_key IS NULL OR btrim(p_section_key) = '' OR p_section_key !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'INVALID_PERMISSION_SECTION';
  END IF;
  UPDATE public.profiles
  SET permissions = jsonb_set(
    COALESCE(permissions, '{}'::jsonb),
    ARRAY[p_section_key],
    COALESCE(p_value, 'null'::jsonb),
    true
  )
  WHERE id = p_user_id
  RETURNING permissions INTO v_permissions;
  IF v_permissions IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;
  RETURN v_permissions;
END;
$$;

REVOKE ALL ON FUNCTION public.update_profile_permission_section(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_profile_permission_section(uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.update_profile_permission_section(uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile_permission_section(uuid, text, jsonb) TO service_role;
'''
migration_path.write_text(m.replace(marker, marker + addition), encoding='utf-8')
print('atomic permission-section save prepared')
