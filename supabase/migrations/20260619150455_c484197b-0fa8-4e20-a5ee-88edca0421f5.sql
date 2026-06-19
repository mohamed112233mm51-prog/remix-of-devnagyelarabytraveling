CREATE OR REPLACE FUNCTION public.prevent_issuing_company_delete_if_used()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  used_count integer := 0;
BEGIN
  -- Trusted server-side maintenance/cleanup runs without an end-user auth.uid().
  -- Allow it to physically delete issuing companies after child tables are wiped.
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT
    (SELECT count(*) FROM public.submissions          WHERE approval_company_id = OLD.id)
  + (SELECT count(*) FROM public.executions           WHERE approval_company_id = OLD.id)
  + (SELECT count(*) FROM public.company_transactions WHERE company_id          = OLD.id)
  INTO used_count;

  IF used_count > 0 THEN
    UPDATE public.issuing_companies SET status = 'غير نشط' WHERE id = OLD.id;
    RAISE EXCEPTION 'COMPANY_IN_USE: تم تعطيل الشركة بدلاً من الحذف لأنها مستخدمة في % سجل', used_count;
  END IF;

  RETURN OLD;
END;
$function$;