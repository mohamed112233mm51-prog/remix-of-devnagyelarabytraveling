REVOKE ALL ON FUNCTION public.can_view_audit_log(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_audit_log(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_audit_log(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_audit_log(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_audit_log(uuid) TO sandbox_exec;