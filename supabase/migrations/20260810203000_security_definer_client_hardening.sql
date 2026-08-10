-- ============================================================================
-- Remove SECURITY DEFINER from functions intentionally callable by signed-in
-- users, and make user_roles self-readable only at the client RLS layer.
--
-- Server-side admin user/role management uses the service-role client and is
-- unaffected by the lack of client INSERT/UPDATE/DELETE policies here.
-- ============================================================================

-- 1) user_roles: authenticated clients only need their own role(s).
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_roles'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', r.policyname);
  END LOOP;
END $$;

CREATE POLICY user_roles_self_select
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No authenticated INSERT/UPDATE/DELETE policies are created intentionally.
-- Existing table grants alone cannot bypass RLS; service_role still bypasses it.

-- 2) has_role no longer needs owner privileges. Under SECURITY INVOKER, an
-- authenticated caller can only see their own user_roles row through the policy
-- above. Passing another user's UUID therefore cannot reveal that user's role.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- 3) Audit-log permission check also operates entirely on the caller's own
-- profile + role, so it can be SECURITY INVOKER as well.
CREATE OR REPLACE FUNCTION public.can_view_audit_log(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    _uid IS NOT NULL
    AND _uid = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = _uid
        AND p.is_active = true
        AND p.invite_accepted = true
        AND (
          p.is_super_admin = true
          OR public.has_role(_uid, 'admin'::public.app_role)
          OR (p.permissions -> 'audit_log_view') = 'true'::jsonb
          OR (
            jsonb_typeof(p.permissions -> 'audit_log_view') = 'object'
            AND COALESCE((p.permissions -> 'audit_log_view' ->> 'view') = 'true', false)
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_audit_log(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_audit_log(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_audit_log(uuid) TO authenticated, service_role;

-- 4) Defense-in-depth: client-executable SECURITY DEFINER functions must be
-- zero after the hardening migrations, except functions that are not granted to
-- authenticated users (trigger-only / service-role-only functions).
