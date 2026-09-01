-- ============================================================================
-- Restore audit-log user labels without reopening the profiles table.
--
-- 20260830007300_settings_permission_rls_hardening.sql intentionally changed
-- profiles SELECT access to self-only. The financial audit UI still needs to
-- resolve performed_by UUIDs to human-readable names, so expose only the two
-- safe fields required by that screen through a permission-gated RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_audit_user_labels(p_user_ids uuid[])
RETURNS TABLE(id uuid, user_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  -- Keep profiles self-only at the RLS layer. This function is the narrow,
  -- audited escape hatch for users who are already allowed to view Audit Log.
  IF NOT COALESCE(public.app_permission_allowed('audit_log_view', 'view'), false) THEN
    RAISE EXCEPTION 'لا تملك صلاحية عرض سجل التدقيق'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.full_name), ''),
      NULLIF(btrim(p.email), ''),
      'مستخدم غير معروف'
    ) AS user_label
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_user_labels(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_audit_user_labels(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_audit_user_labels(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_audit_user_labels(uuid[]) IS
  'Returns id + display label only for requested users, gated by audit_log_view permission.';
