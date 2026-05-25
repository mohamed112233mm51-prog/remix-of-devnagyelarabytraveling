-- 1) Fix mutable search_path on touch_updated_at
ALTER FUNCTION public.touch_updated_at() SET search_path = public;

-- 2) Restrict agent_service_pricing writes to admins
DROP POLICY IF EXISTS agent_service_pricing_auth_insert ON public.agent_service_pricing;
DROP POLICY IF EXISTS agent_service_pricing_auth_update ON public.agent_service_pricing;
DROP POLICY IF EXISTS agent_service_pricing_auth_delete ON public.agent_service_pricing;

CREATE POLICY agent_service_pricing_admin_insert
  ON public.agent_service_pricing FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY agent_service_pricing_admin_update
  ON public.agent_service_pricing FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY agent_service_pricing_admin_delete
  ON public.agent_service_pricing FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3) Prevent privilege escalation via profiles self-update.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot modify profile id';
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'Only admins can change is_super_admin';
  END IF;
  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    RAISE EXCEPTION 'Only admins can change permissions';
  END IF;
  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'Only admins can change invited_by';
  END IF;
  IF NEW.invite_accepted IS DISTINCT FROM OLD.invite_accepted THEN
    RAISE EXCEPTION 'Only admins can change invite_accepted';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_privilege_escalation_trg ON public.profiles;
CREATE TRIGGER prevent_profile_privilege_escalation_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();