-- Clean invalid dropdown option rows only
DELETE FROM public.system_dropdown_options
WHERE category IS NULL
   OR btrim(category) = ''
   OR category NOT IN ('authority', 'destination', 'airline', 'service_type')
   OR value IS NULL
   OR btrim(value) = '';

-- Normalize existing values without changing business records
UPDATE public.system_dropdown_options
SET category = btrim(category), value = btrim(value), is_active = COALESCE(is_active, true)
WHERE category <> btrim(category)
   OR value <> btrim(value)
   OR is_active IS NULL;

-- Remove duplicate dropdown settings rows, keeping the oldest row per category/value
DELETE FROM public.system_dropdown_options s
USING public.system_dropdown_options keep
WHERE s.category = keep.category
  AND btrim(s.value) = btrim(keep.value)
  AND s.created_at >= keep.created_at
  AND s.id <> keep.id
  AND keep.id = (
    SELECT id
    FROM public.system_dropdown_options x
    WHERE x.category = s.category
      AND btrim(x.value) = btrim(s.value)
    ORDER BY x.created_at ASC, x.id ASC
    LIMIT 1
  );

CREATE OR REPLACE FUNCTION public.validate_system_dropdown_option()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.category := btrim(COALESCE(NEW.category, ''));
  NEW.value := btrim(COALESCE(NEW.value, ''));
  NEW.is_active := COALESCE(NEW.is_active, true);

  IF NEW.category NOT IN ('authority', 'destination', 'airline', 'service_type') THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_system_dropdown_option_trigger ON public.system_dropdown_options;
CREATE TRIGGER validate_system_dropdown_option_trigger
BEFORE INSERT OR UPDATE ON public.system_dropdown_options
FOR EACH ROW
EXECUTE FUNCTION public.validate_system_dropdown_option();

CREATE UNIQUE INDEX IF NOT EXISTS system_dropdown_options_category_value_unique
ON public.system_dropdown_options (category, value);