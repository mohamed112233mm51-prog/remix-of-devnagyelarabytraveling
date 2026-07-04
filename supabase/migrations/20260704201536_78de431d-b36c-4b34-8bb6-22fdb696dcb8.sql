
CREATE OR REPLACE FUNCTION public.restore_disable_guards()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ALTER TABLE public.cash_boxes DISABLE TRIGGER USER;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_enable_guards()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ALTER TABLE public.cash_boxes ENABLE TRIGGER USER;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_disable_guards() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_enable_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_disable_guards() TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_enable_guards() TO service_role;
