
-- ============================================================
-- Submissions + Executions restructuring
-- Safe migration: only ADDS new tables/dropdowns; no data loss.
-- ============================================================

-- 1) submissions (التقديمات — لا أثر مالي)
CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  services text[] NOT NULL DEFAULT '{}',
  passenger_name text NOT NULL,
  national_id text,
  dob date,
  passport text,
  birth_place text,
  agent_id uuid,
  status text NOT NULL DEFAULT 'قيد المتابعة',
  departure_from text,
  submit_date date,
  issue_date date,
  approval_authority text,
  notes text,
  executed_at timestamptz,
  execution_id uuid,
  is_demo boolean NOT NULL DEFAULT false
);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submissions_auth_select" ON public.submissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "submissions_auth_insert" ON public.submissions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "submissions_auth_update" ON public.submissions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "submissions_auth_delete" ON public.submissions
  FOR DELETE TO authenticated USING (true);

-- 2) executions (التنفيذ — هو الوحيد المالي)
CREATE TABLE IF NOT EXISTS public.executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submission_id uuid,
  passenger_name text NOT NULL,
  national_id text,
  dob date,
  passport text,
  birth_place text,
  agent_id uuid,
  status text NOT NULL DEFAULT 'قيد التنفيذ',
  departure_from text,
  destination text,
  airline text,
  travel_date date,
  notes text,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_demo boolean NOT NULL DEFAULT false
);

ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "executions_auth_select" ON public.executions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "executions_auth_insert" ON public.executions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "executions_auth_update" ON public.executions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "executions_auth_delete" ON public.executions
  FOR DELETE TO authenticated USING (true);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_submissions_touch ON public.submissions;
CREATE TRIGGER trg_submissions_touch BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_executions_touch ON public.executions;
CREATE TRIGGER trg_executions_touch BEFORE UPDATE ON public.executions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Extend system_dropdown_options to accept new categories
ALTER TABLE public.system_dropdown_options
  DROP CONSTRAINT IF EXISTS system_dropdown_options_category_check;

CREATE OR REPLACE FUNCTION public.validate_system_dropdown_option()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  NEW.category := btrim(COALESCE(NEW.category, ''));
  NEW.value    := btrim(COALESCE(NEW.value, ''));
  NEW.is_active := COALESCE(NEW.is_active, true);

  IF NEW.category NOT IN (
    'authority','destination','airline','service_type',
    'execution_status','submission_status','departure_from','service_kind'
  ) THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END; $$;

-- 4) Seed default dropdown values (idempotent)
INSERT INTO public.system_dropdown_options (category, value, is_active) VALUES
  ('execution_status','قيد التنفيذ', true),
  ('execution_status','منفذ', true),
  ('execution_status','ملغي', true),
  ('execution_status','مؤجل', true),
  ('submission_status','قيد المتابعة', true),
  ('submission_status','جاهز للتنفيذ', true),
  ('submission_status','مؤجل', true),
  ('submission_status','ملغي', true),
  ('service_kind','موافقة أمنية', true),
  ('service_kind','تذكرة طيران', true),
  ('service_kind','استثمار ليبي', true)
ON CONFLICT DO NOTHING;

-- 5) Realtime
ALTER TABLE public.submissions REPLICA IDENTITY FULL;
ALTER TABLE public.executions  REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.executions;  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
