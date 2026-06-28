
-- =========================================================
-- 1) Replace "USING (true)" / "WITH CHECK (true)" with auth.uid() IS NOT NULL
--    on all flagged INSERT/UPDATE/DELETE policies.
-- =========================================================

DO $$
DECLARE
  r RECORD;
  new_qual text;
  new_chk  text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('INSERT','UPDATE','DELETE')
      AND ((qual = 'true') OR (with_check = 'true'))
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    IF r.cmd = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL)',
        r.policyname, r.schemaname, r.tablename
      );
    ELSIF r.cmd = 'DELETE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL)',
        r.policyname, r.schemaname, r.tablename
      );
    ELSIF r.cmd = 'UPDATE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
        r.policyname, r.schemaname, r.tablename
      );
    END IF;
  END LOOP;
END $$;

-- =========================================================
-- 2) Storage: drop the broad public SELECT (listing) policy on company-assets.
--    Public bucket files remain reachable through the /object/public/ CDN URL
--    without RLS, so logos still load on the login page.
-- =========================================================
DROP POLICY IF EXISTS "company-assets public read" ON storage.objects;

-- =========================================================
-- 3) Lock down SECURITY DEFINER functions that should never be called
--    directly by clients. Triggers run as table owner and ignore EXECUTE
--    grants, so revoking is safe.
-- =========================================================
REVOKE ALL ON FUNCTION public.handle_new_user()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_auto_expense_deductions()          FROM PUBLIC, anon, authenticated;

-- has_role is intentionally callable by signed-in users (used in RLS expressions).
REVOKE ALL  ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
