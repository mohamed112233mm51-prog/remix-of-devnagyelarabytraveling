from pathlib import Path

# Backups must follow settings.backups_manage, not the admin role.
p = Path('src/lib/backups.functions.ts')
s = p.read_text(encoding='utf-8')
old = '''async function ensureAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Response("Forbidden", { status: 403 });
}
'''
new = '''async function ensureAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_super_admin, permissions")
    .eq("id", userId)
    .maybeSingle();
  const permissions = (profile as any)?.permissions ?? {};
  if ((profile as any)?.is_super_admin === true || permissions?.settings?.backups_manage === true) return;
  throw new Response("Forbidden: settings.backups_manage permission required", { status: 403 });
}
'''
if old not in s: raise SystemExit('backups ensureAdmin block not found')
p.write_text(s.replace(old, new), encoding='utf-8')

# Production/demo tools must follow settings.system_tools, not the admin role.
p = Path('src/lib/demo-data.functions.ts')
s = p.read_text(encoding='utf-8')
old = '''async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Response("Forbidden", { status: 403 });
}
'''
new = '''async function ensureAdmin(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin, permissions")
    .eq("id", userId)
    .maybeSingle();
  const permissions = (profile as any)?.permissions ?? {};
  if ((profile as any)?.is_super_admin === true || permissions?.settings?.system_tools === true) return;
  throw new Response("Forbidden: settings.system_tools permission required", { status: 403 });
}
'''
if old not in s: raise SystemExit('demo-data ensureAdmin block not found')
p.write_text(s.replace(old, new), encoding='utf-8')

migration = Path('supabase/migrations/20260824173500_settings_permission_rls_hardening.sql')
migration.write_text(r'''-- Permission/RLS alignment for settings and profile privilege boundaries.
-- This migration is intentionally committed for review first; do not promote to
-- production until it has been applied and verified on the development project.

CREATE OR REPLACE FUNCTION public.app_settings_permission_allowed(p_subkey text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT
      p.is_active = true
      AND p.invite_accepted = true
      AND (
        p.is_super_admin = true
        OR (
          jsonb_typeof(p.permissions -> 'settings') = 'object'
          AND COALESCE((p.permissions -> 'settings' ->> p_subkey) = 'true', false)
        )
      )
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), false);
$$;

REVOKE ALL ON FUNCTION public.app_settings_permission_allowed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_settings_permission_allowed(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_settings_permission_allowed(text) TO authenticated, service_role;

-- Authenticated clients may only read/update their own profile. Administrative
-- profile changes now go through trusted server functions using service_role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('SELECT','UPDATE','ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', r.policyname);
  END LOOP;
END $$;

CREATE POLICY profiles_self_select_only ON public.profiles
FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_self_update_only ON public.profiles
FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trusted service-role/server contexts have no end-user auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot modify profile id';
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'Only trusted server functions can change is_super_admin';
  END IF;
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    RAISE EXCEPTION 'Only trusted server functions can change permissions';
  END IF;
  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'Only trusted server functions can change invited_by';
  END IF;
  IF NEW.invite_accepted IS DISTINCT FROM OLD.invite_accepted THEN
    RAISE EXCEPTION 'Only trusted server functions can change invite_accepted';
  END IF;
  RETURN NEW;
END;
$$;

-- Company settings: explicit company_manage (or Super Admin), never role-only admin.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='app_settings'
  LOOP EXECUTE format('DROP POLICY %I ON public.app_settings', r.policyname); END LOOP;
END $$;
CREATE POLICY app_settings_read_authenticated ON public.app_settings
FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_company_manage_insert ON public.app_settings
FOR INSERT TO authenticated WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY app_settings_company_manage_update ON public.app_settings
FOR UPDATE TO authenticated USING (public.app_settings_permission_allowed('company_manage'))
WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY app_settings_company_manage_delete ON public.app_settings
FOR DELETE TO authenticated USING (public.app_settings_permission_allowed('company_manage'));

-- Dropdowns are edited from General Settings, so they follow company_manage too.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='system_dropdown_options'
  LOOP EXECUTE format('DROP POLICY %I ON public.system_dropdown_options', r.policyname); END LOOP;
END $$;
CREATE POLICY dropdown_read_authenticated ON public.system_dropdown_options
FOR SELECT TO authenticated USING (true);
CREATE POLICY dropdown_company_manage_insert ON public.system_dropdown_options
FOR INSERT TO authenticated WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY dropdown_company_manage_update ON public.system_dropdown_options
FOR UPDATE TO authenticated USING (public.app_settings_permission_allowed('company_manage'))
WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY dropdown_company_manage_delete ON public.system_dropdown_options
FOR DELETE TO authenticated USING (public.app_settings_permission_allowed('company_manage'));

-- Company asset uploads follow company_manage. Public read policy is left intact.
DROP POLICY IF EXISTS "company-assets admin insert" ON storage.objects;
DROP POLICY IF EXISTS "company-assets admin update" ON storage.objects;
DROP POLICY IF EXISTS "company-assets admin delete" ON storage.objects;
CREATE POLICY "company-assets company_manage insert" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage')
);
CREATE POLICY "company-assets company_manage update" ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage')
) WITH CHECK (
  bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage')
);
CREATE POLICY "company-assets company_manage delete" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage')
);

-- Direct access to backup storage/logs follows backups_manage. Server backup
-- functions continue to use service_role and are independently authorized.
DROP POLICY IF EXISTS "system_backups admin read" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin write" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin update" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin delete" ON storage.objects;
CREATE POLICY "system_backups backups_manage read" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);
CREATE POLICY "system_backups backups_manage write" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);
CREATE POLICY "system_backups backups_manage update" ON storage.objects
FOR UPDATE TO authenticated USING (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
) WITH CHECK (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);
CREATE POLICY "system_backups backups_manage delete" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='backup_logs'
  LOOP EXECUTE format('DROP POLICY %I ON public.backup_logs', r.policyname); END LOOP;
END $$;
CREATE POLICY backup_logs_backups_manage_select ON public.backup_logs
FOR SELECT TO authenticated USING (public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY backup_logs_backups_manage_insert ON public.backup_logs
FOR INSERT TO authenticated WITH CHECK (public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY backup_logs_backups_manage_update ON public.backup_logs
FOR UPDATE TO authenticated USING (public.app_settings_permission_allowed('backups_manage'))
WITH CHECK (public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY backup_logs_backups_manage_delete ON public.backup_logs
FOR DELETE TO authenticated USING (public.app_settings_permission_allowed('backups_manage'));
''', encoding='utf-8')

print('settings server authorization + review-only RLS migration prepared')
