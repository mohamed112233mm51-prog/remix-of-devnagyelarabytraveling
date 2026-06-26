
-- 1) Agents tier column
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'A';

-- 2) Allow new dropdown category 'agent_tier' in validator
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
    'submission_notes','airport','operation_status','passenger_type',
    'agent_tier'
  ) THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END; $function$;

-- 3) Seed default tiers (safe if exists)
INSERT INTO public.system_dropdown_options (category, value, is_active)
VALUES ('agent_tier','A',true), ('agent_tier','B',true), ('agent_tier','C',true)
ON CONFLICT DO NOTHING;

-- 4) Pricing rules table
CREATE TABLE IF NOT EXISTS public.company_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.issuing_companies(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  agent_tier text NOT NULL,
  departure_from text,
  destination text,
  airline text,
  approval_company_id uuid REFERENCES public.issuing_companies(id) ON DELETE SET NULL,
  status text,
  passenger_type text,
  company_price numeric NOT NULL DEFAULT 0,
  commission_type text NOT NULL DEFAULT 'percentage' CHECK (commission_type IN ('percentage','fixed')),
  commission_value numeric NOT NULL DEFAULT 0,
  agent_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpr_company ON public.company_pricing_rules(company_id);
CREATE INDEX IF NOT EXISTS idx_cpr_lookup ON public.company_pricing_rules(company_id, service_type, agent_tier);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_pricing_rules TO authenticated;
GRANT ALL ON public.company_pricing_rules TO service_role;

ALTER TABLE public.company_pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cpr_select" ON public.company_pricing_rules;
DROP POLICY IF EXISTS "cpr_insert" ON public.company_pricing_rules;
DROP POLICY IF EXISTS "cpr_update" ON public.company_pricing_rules;
DROP POLICY IF EXISTS "cpr_delete" ON public.company_pricing_rules;

CREATE POLICY "cpr_select" ON public.company_pricing_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "cpr_insert" ON public.company_pricing_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cpr_update" ON public.company_pricing_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cpr_delete" ON public.company_pricing_rules FOR DELETE TO authenticated USING (true);

-- 5) Auto-calc agent_price + touch updated_at
CREATE OR REPLACE FUNCTION public.calc_company_pricing_agent_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.commission_type = 'fixed' THEN
    NEW.agent_price := COALESCE(NEW.company_price,0) + COALESCE(NEW.commission_value,0);
  ELSE
    NEW.agent_price := ROUND( (COALESCE(NEW.company_price,0) * (1 + COALESCE(NEW.commission_value,0)/100))::numeric, 2);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_cpr_calc ON public.company_pricing_rules;
CREATE TRIGGER trg_cpr_calc
  BEFORE INSERT OR UPDATE ON public.company_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.calc_company_pricing_agent_price();

-- 6) Drop old pricing table (user confirmed)
DROP TABLE IF EXISTS public.agent_service_pricing CASCADE;
