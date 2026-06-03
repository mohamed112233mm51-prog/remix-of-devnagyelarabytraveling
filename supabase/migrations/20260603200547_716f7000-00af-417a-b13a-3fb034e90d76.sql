
-- 1) Drop the deprecated tables (data loss confirmed by user)
DROP TABLE IF EXISTS public.flights CASCADE;
DROP TABLE IF EXISTS public.approvals CASCADE;

-- 2) Reduce Realtime publication to only the 5 operational tables.
-- Remove all current entries (ignore errors if a table isn't in the publication).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT schemaname || '.' || tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %s', t);
  END LOOP;
END $$;

-- Re-add only the 5 tables the user wants Realtime on
ALTER TABLE public.agents              REPLICA IDENTITY FULL;
ALTER TABLE public.issuing_companies   REPLICA IDENTITY FULL;
ALTER TABLE public.submissions         REPLICA IDENTITY FULL;
ALTER TABLE public.executions          REPLICA IDENTITY FULL;
ALTER TABLE public.transactions        REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.issuing_companies;
ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.executions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
-- Keep system_dropdown_options on realtime — settings page needs live dropdowns
ALTER TABLE public.system_dropdown_options REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_dropdown_options;

-- 3) Update dropdown values
-- Replace 'العراق' with 'البراق'
UPDATE public.system_dropdown_options
   SET value = 'البراق'
 WHERE category = 'airline' AND value = 'العراق';

-- Ensure full airline list exists & is active
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT 'airline', v, true FROM (VALUES
  ('البراق'), ('البرنيق'), ('الليبية'), ('إير كايرو'),
  ('تاج'), ('مصر للطيران'), ('الأفريقية')
) AS x(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options s
   WHERE s.category = 'airline' AND s.value = x.v
);

-- Add 'جمرك بري' to departure_from
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT 'departure_from', v, true FROM (VALUES
  ('مطار القاهرة'), ('برج العرب'), ('جمرك بري')
) AS x(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options s
   WHERE s.category = 'departure_from' AND s.value = x.v
);

-- 4) Drop validation trigger that referenced approvals (it auto-disables companies; harmless to keep, leave it).
