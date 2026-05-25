
-- Add approval_company_id linking to issuing_companies for submissions and executions
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS approval_company_id uuid;
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS approval_company_id uuid;

CREATE INDEX IF NOT EXISTS idx_submissions_approval_company ON public.submissions(approval_company_id);
CREATE INDEX IF NOT EXISTS idx_executions_approval_company ON public.executions(approval_company_id);

-- Backfill submissions.approval_company_id from existing approval_authority text (match by company_name)
UPDATE public.submissions s
SET approval_company_id = ic.id
FROM public.issuing_companies ic
WHERE s.approval_company_id IS NULL
  AND s.approval_authority IS NOT NULL
  AND btrim(s.approval_authority) <> ''
  AND lower(btrim(ic.company_name)) = lower(btrim(s.approval_authority));

-- Prevent hard delete of an issuing_company that is referenced anywhere; force soft-disable via status
CREATE OR REPLACE FUNCTION public.prevent_issuing_company_delete_if_used()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  used_count integer := 0;
BEGIN
  SELECT
    (SELECT count(*) FROM public.submissions          WHERE approval_company_id = OLD.id)
  + (SELECT count(*) FROM public.executions           WHERE approval_company_id = OLD.id)
  + (SELECT count(*) FROM public.approvals            WHERE issuing_company_id  = OLD.id)
  + (SELECT count(*) FROM public.company_transactions WHERE company_id          = OLD.id)
  INTO used_count;

  IF used_count > 0 THEN
    UPDATE public.issuing_companies SET status = 'غير نشط' WHERE id = OLD.id;
    RAISE EXCEPTION 'COMPANY_IN_USE: تم تعطيل الشركة بدلاً من الحذف لأنها مستخدمة في % سجل', used_count;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_issuing_company_delete ON public.issuing_companies;
CREATE TRIGGER trg_prevent_issuing_company_delete
BEFORE DELETE ON public.issuing_companies
FOR EACH ROW EXECUTE FUNCTION public.prevent_issuing_company_delete_if_used();
