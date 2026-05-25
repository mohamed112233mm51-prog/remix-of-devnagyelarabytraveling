
-- 1) Add operation_status columns
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS operation_status text NOT NULL DEFAULT 'قيد المتابعة';

ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS operation_status text NOT NULL DEFAULT 'قيد التنفيذ';

-- 2) Migrate workflow values out of status into operation_status (preserve data)
UPDATE public.submissions
SET operation_status = status,
    status = 'بطيء'
WHERE status IN ('قيد المتابعة','جاهز للتنفيذ','ملغي','مؤجل','جاهز','منفذ','قيد التنفيذ');

UPDATE public.executions
SET operation_status = status,
    status = 'بطيء'
WHERE status IN ('قيد التنفيذ','منفذ','ملغي','مؤجل','جاهز','جاهز للتنفيذ','قيد المتابعة');

-- 3) Update column defaults: status now means approval status
ALTER TABLE public.submissions ALTER COLUMN status SET DEFAULT 'بطيء';
ALTER TABLE public.executions  ALTER COLUMN status SET DEFAULT 'بطيء';

-- 4) Extend dropdown trigger to allow operation_status category
CREATE OR REPLACE FUNCTION public.validate_system_dropdown_option()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.category := btrim(COALESCE(NEW.category, ''));
  NEW.value    := btrim(COALESCE(NEW.value, ''));
  NEW.is_active := COALESCE(NEW.is_active, true);

  IF NEW.category NOT IN (
    'authority','destination','airline','service_type',
    'execution_status','submission_status','departure_from','service_kind',
    'submission_notes','airport','operation_status'
  ) THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END; $function$;

-- 5) Seed approval status values (idempotent) for both legacy categories used by forms
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT t.c, t.v, true
FROM (VALUES
  ('submission_status','بطيء'),
  ('submission_status','سريع'),
  ('submission_status','رفض أمني'),
  ('execution_status','بطيء'),
  ('execution_status','سريع'),
  ('execution_status','رفض أمني')
) AS t(c,v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options s
  WHERE s.category = t.c AND s.value = t.v
);

-- 6) Seed operation_status defaults
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT 'operation_status', v, true
FROM (VALUES
  ('قيد المتابعة'),
  ('قيد التنفيذ'),
  ('جاهز للتنفيذ'),
  ('منفذ'),
  ('مؤجل'),
  ('ملغي')
) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options s
  WHERE s.category = 'operation_status' AND s.value = t.v
);
