-- Tighten financial_audit_log SELECT policy to require audit_log_view permission
CREATE OR REPLACE FUNCTION public.can_view_audit_log(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _uid
      AND (
        p.is_super_admin = true
        OR (p.permissions ? 'audit_log_view'
            AND (
              (p.permissions->'audit_log_view') = 'true'::jsonb
              OR (p.permissions->'audit_log_view'->>'view') = 'true'
            ))
      )
  )
  OR public.has_role(_uid, 'admin'::public.app_role);
$$;

DROP POLICY IF EXISTS "audit log readable by authenticated" ON public.financial_audit_log;
CREATE POLICY "audit log readable by authorized users"
  ON public.financial_audit_log
  FOR SELECT
  TO authenticated
  USING (public.can_view_audit_log(auth.uid()));