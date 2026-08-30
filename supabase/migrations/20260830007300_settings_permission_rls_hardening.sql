-- ============================================================================
-- Settings permission / profile privilege hardening, salvaged and corrected
-- from permissions-hardening for the current devo schema.
--
-- IMPORTANT: adding this migration to Git does not apply it to Supabase.
-- Apply and verify on the development database before any production promotion.
-- ============================================================================

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

-- Authenticated users may read/update their own profile only. Sensitive fields
-- are protected by a BEFORE UPDATE trigger; trusted service_role server calls
-- have auth.uid() = NULL and can perform explicit administrative changes.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND cmd IN ('SELECT','UPDATE','ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', r.policyname);
  END LOOP;
END $$;

CREATE POLICY profiles_self_select_only ON public.profiles
FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY profiles_self_update_only ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS DISTINCT FROM OLD.id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot modify another profile or profile id';
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'Only trusted server functions can change is_super_admin';
  END IF;
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    RAISE EXCEPTION 'Only trusted server functions can change permissions';
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only trusted server functions can change is_active';
  END IF;
  IF NEW.invite_accepted IS DISTINCT FROM OLD.invite_accepted THEN
    RAISE EXCEPTION 'Only trusted server functions can change invite_accepted';
  END IF;
  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'Only trusted server functions can change invited_by';
  END IF;
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'Only trusted server functions can change agent_id';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM authenticated;

DROP TRIGGER IF EXISTS profiles_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_privilege_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- Company settings and dropdown maintenance require company_manage explicitly.
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    FOR r IN SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename='app_settings'
    LOOP EXECUTE format('DROP POLICY %I ON public.app_settings', r.policyname); END LOOP;
  END IF;
END $$;

CREATE POLICY app_settings_read_authenticated ON public.app_settings
FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_company_manage_insert ON public.app_settings
FOR INSERT TO authenticated WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY app_settings_company_manage_update ON public.app_settings
FOR UPDATE TO authenticated
USING (public.app_settings_permission_allowed('company_manage'))
WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY app_settings_company_manage_delete ON public.app_settings
FOR DELETE TO authenticated USING (public.app_settings_permission_allowed('company_manage'));

DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.system_dropdown_options') IS NOT NULL THEN
    FOR r IN SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename='system_dropdown_options'
    LOOP EXECUTE format('DROP POLICY %I ON public.system_dropdown_options', r.policyname); END LOOP;
  END IF;
END $$;

CREATE POLICY dropdown_read_authenticated ON public.system_dropdown_options
FOR SELECT TO authenticated USING (true);
CREATE POLICY dropdown_company_manage_insert ON public.system_dropdown_options
FOR INSERT TO authenticated WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY dropdown_company_manage_update ON public.system_dropdown_options
FOR UPDATE TO authenticated
USING (public.app_settings_permission_allowed('company_manage'))
WITH CHECK (public.app_settings_permission_allowed('company_manage'));
CREATE POLICY dropdown_company_manage_delete ON public.system_dropdown_options
FOR DELETE TO authenticated USING (public.app_settings_permission_allowed('company_manage'));

-- Known legacy storage policies are replaced with explicit settings permissions.
DROP POLICY IF EXISTS "company-assets admin insert" ON storage.objects;
DROP POLICY IF EXISTS "company-assets admin update" ON storage.objects;
DROP POLICY IF EXISTS "company-assets admin delete" ON storage.objects;
DROP POLICY IF EXISTS "company-assets company_manage insert" ON storage.objects;
DROP POLICY IF EXISTS "company-assets company_manage update" ON storage.objects;
DROP POLICY IF EXISTS "company-assets company_manage delete" ON storage.objects;

CREATE POLICY "company-assets company_manage insert" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage')
);
CREATE POLICY "company-assets company_manage update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage'))
WITH CHECK (bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage'));
CREATE POLICY "company-assets company_manage delete" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'company-assets' AND public.app_settings_permission_allowed('company_manage')
);

DROP POLICY IF EXISTS "system_backups admin read" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin write" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin update" ON storage.objects;
DROP POLICY IF EXISTS "system_backups admin delete" ON storage.objects;
DROP POLICY IF EXISTS "system_backups backups_manage read" ON storage.objects;
DROP POLICY IF EXISTS "system_backups backups_manage write" ON storage.objects;
DROP POLICY IF EXISTS "system_backups backups_manage update" ON storage.objects;
DROP POLICY IF EXISTS "system_backups backups_manage delete" ON storage.objects;

CREATE POLICY "system_backups backups_manage read" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);
CREATE POLICY "system_backups backups_manage write" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);
CREATE POLICY "system_backups backups_manage update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage'))
WITH CHECK (bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY "system_backups backups_manage delete" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'system-backups' AND public.app_settings_permission_allowed('backups_manage')
);

DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.backup_logs') IS NOT NULL THEN
    FOR r IN SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename='backup_logs'
    LOOP EXECUTE format('DROP POLICY %I ON public.backup_logs', r.policyname); END LOOP;
  END IF;
END $$;

CREATE POLICY backup_logs_backups_manage_select ON public.backup_logs
FOR SELECT TO authenticated USING (public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY backup_logs_backups_manage_insert ON public.backup_logs
FOR INSERT TO authenticated WITH CHECK (public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY backup_logs_backups_manage_update ON public.backup_logs
FOR UPDATE TO authenticated
USING (public.app_settings_permission_allowed('backups_manage'))
WITH CHECK (public.app_settings_permission_allowed('backups_manage'));
CREATE POLICY backup_logs_backups_manage_delete ON public.backup_logs
FOR DELETE TO authenticated USING (public.app_settings_permission_allowed('backups_manage'));
