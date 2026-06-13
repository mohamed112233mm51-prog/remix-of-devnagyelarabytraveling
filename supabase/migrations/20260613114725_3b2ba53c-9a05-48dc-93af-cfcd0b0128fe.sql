
-- Add passenger_type to submissions and executions
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS passenger_type text;
ALTER TABLE public.executions  ADD COLUMN IF NOT EXISTS passenger_type text;

-- Replicate approval validity fields on executions
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS approval_validity_enabled boolean DEFAULT false;
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS issue_date date;

-- Extend dropdown validation trigger to allow new 'passenger_type' category
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
    'submission_notes','airport','operation_status','passenger_type'
  ) THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END; $function$;

-- Seed default passenger types (idempotent)
INSERT INTO public.system_dropdown_options (category, value, is_active)
VALUES
  ('passenger_type','سيدات', true),
  ('passenger_type','رضع', true),
  ('passenger_type','طفل تحت 8', true),
  ('passenger_type','طفل تحت 12', true)
ON CONFLICT DO NOTHING;
