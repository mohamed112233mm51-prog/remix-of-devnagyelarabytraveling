-- =====================================================================
-- all_migrations.sql
-- Consolidated, idempotent migration bundle.
--
-- - Each original migration statement is wrapped in a DO block that
--   catches "already exists" / duplicate errors and continues.
-- - Safe to run against an older database: creates missing objects,
--   skips existing ones, never DROPs data.
-- - Run on a staging (Steady) environment first, then Production.
-- =====================================================================

SET client_min_messages TO NOTICE;

DO $$ BEGIN RAISE NOTICE '>>> Starting consolidated migration bundle...'; END $$;


-- ---------------------------------------------------------------------
-- Migration: 20260507161123_170a1cb8-ad6b-42df-9adc-c23ada3b96e0.sql  (19 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260507161123_170a1cb8-ad6b-42df-9adc-c23ada3b96e0.sql'; END $$;

DO $mig$
BEGIN
-- Agents (the only "client-like" entity — agents are the company's customers)
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  phone text,
  airline text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TABLE public.flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_name text NOT NULL,
  passport text,
  dob date,
  airline text,
  destination text,
  travel_date date,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'محجوز',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_name text NOT NULL,
  passport text,
  dob date,
  destination text,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  approval_type text NOT NULL DEFAULT 'طيران',
  submit_date date,
  issue_date date,
  status text NOT NULL DEFAULT 'معلق',
  government_fee numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  destination text,
  count integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'نقدي',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX ON public.flights(agent_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX ON public.approvals(agent_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX ON public.transactions(agent_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- RLS: open access (no auth in MVP)
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.flights ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.agents FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.flights FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.approvals FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.flights;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260507181409_119e9455-e118-4563-b581-5d9686ab1636.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260507181409_119e9455-e118-4563-b581-5d9686ab1636.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.agents DROP COLUMN IF EXISTS code;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260507194805_148c2767-9b7e-4fcd-8818-8b760f9ce6b6.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260507194805_148c2767-9b7e-4fcd-8818-8b760f9ce6b6.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS national_id text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260507202511_3c6d2a72-b722-4c07-96e9-d7f0ae0eb0c6.sql  (3 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260507202511_3c6d2a72-b722-4c07-96e9-d7f0ae0eb0c6.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS national_id text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals DROP COLUMN IF EXISTS approval_type;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals ALTER COLUMN status SET DEFAULT 'سريعة';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260508123323_261b31d0-a657-44dd-aef0-8bfeafadccd6.sql  (4 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260508123323_261b31d0-a657-44dd-aef0-8bfeafadccd6.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS travel_statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS travel_statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS authority text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS travel_statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260508133410_f267bad8-749b-4a07-9883-02246d10e688.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260508133410_f267bad8-749b-4a07-9883-02246d10e688.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS issuing_company text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260508135352_4864bbe0-5f2f-458d-be97-973f627e7262.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260508135352_4864bbe0-5f2f-458d-be97-973f627e7262.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS instapay_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mobile_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mobile_cash_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260508142637_60f0f49b-fffb-4f71-a73b-3fa3bd8b2a9a.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260508142637_60f0f49b-fffb-4f71-a73b-3fa3bd8b2a9a.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS governorate text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.agents DROP COLUMN IF EXISTS airline;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260508144449_adc21442-792a-436e-81f7-7b387bbff1bb.sql  (9 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260508144449_adc21442-792a-436e-81f7-7b387bbff1bb.sql'; END $$;

DO $mig$
BEGIN
-- Issuing companies (suppliers)
CREATE TABLE public.issuing_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  phone text,
  whatsapp text,
  service_type text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.issuing_companies ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY open_all ON public.issuing_companies FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Company financial transactions (money paid OUT to supplier)
CREATE TABLE public.company_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  destination text,
  count integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  trip_value numeric NOT NULL DEFAULT 0,
  instapay_amount numeric NOT NULL DEFAULT 0,
  cash_amount numeric NOT NULL DEFAULT 0,
  mobile_cash_amount numeric NOT NULL DEFAULT 0,
  mobile_cash_net_amount numeric NOT NULL DEFAULT 0,
  total_paid numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY open_all ON public.company_transactions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Link approvals to issuing company by id (keep existing issuing_company text for backward compat)
ALTER TABLE public.approvals ADD COLUMN issuing_company_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.issuing_companies;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_transactions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260509104052_6070e8ac-6d71-4b57-8d5f-cfca502b1778.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260509104052_6070e8ac-6d71-4b57-8d5f-cfca502b1778.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS issuing_company text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260509114454_d7c50f3b-4203-4c0c-9fd3-277370bf690a.sql  (12 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260509114454_d7c50f3b-4203-4c0c-9fd3-277370bf690a.sql'; END $$;

DO $mig$
BEGIN
-- Add new payment columns to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_cash_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.transactions
SET arabic_tourism_cash_amount = COALESCE(NULLIF(arabic_tourism_cash_amount,0), mobile_cash_amount),
    arabic_tourism_cash_net_amount = COALESCE(NULLIF(arabic_tourism_cash_net_amount,0), mobile_cash_net_amount)
WHERE mobile_cash_amount IS NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Add new payment columns to company_transactions
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_cash_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.company_transactions
SET arabic_tourism_cash_amount = COALESCE(NULLIF(arabic_tourism_cash_amount,0), mobile_cash_amount),
    arabic_tourism_cash_net_amount = COALESCE(NULLIF(arabic_tourism_cash_net_amount,0), mobile_cash_net_amount)
WHERE mobile_cash_amount IS NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Merchants table
CREATE TABLE IF NOT EXISTS public.merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_name text NOT NULL,
  phone text,
  whatsapp text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.merchants FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Merchant cash collections
CREATE TABLE IF NOT EXISTS public.merchant_cash_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchant_cash_collections ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.merchant_cash_collections FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchants;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_cash_collections;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260509120033_adcb335b-3faa-46a5-a63c-e1cced925175.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260509120033_adcb335b-3faa-46a5-a63c-e1cced925175.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS merchant_cash_net_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS merchant_cash_net_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260509121633_0d4dffcd-d8db-47e2-b2d1-0e6c2acb00f6.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260509121633_0d4dffcd-d8db-47e2-b2d1-0e6c2acb00f6.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS service_type text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS service_type text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260509172401_40795a4d-d2dc-4739-ab32-ca9d683ff164.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260509172401_40795a4d-d2dc-4739-ab32-ca9d683ff164.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS merchant_cash_physical_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS merchant_cash_physical_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260510100010_461e18c3-21a0-4da7-9b0b-df7e07adfa21.sql  (8 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260510100010_461e18c3-21a0-4da7-9b0b-df7e07adfa21.sql'; END $$;

DO $mig$
BEGIN
CREATE TABLE public.investors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_name text NOT NULL,
  phone text,
  whatsapp text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.investors FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TABLE public.investor_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_id uuid NOT NULL,
  transaction_type text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  payment_method text,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investor_transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.investor_transactions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.investors;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.investor_transactions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260510121709_607ff318-7161-4756-8b34-0b9897ad3e73.sql  (3 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260510121709_607ff318-7161-4756-8b34-0b9897ad3e73.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS supports_instapay boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_cash_wallet boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_physical_cash boolean NOT NULL DEFAULT true;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS merchant_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260510144458_f1b76638-52d1-4591-a017-258bc490563c.sql  (11 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260510144458_f1b76638-52d1-4591-a017-258bc490563c.sql'; END $$;

DO $mig$
BEGIN
-- Expenses tables
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_name text NOT NULL,
  expense_type text NOT NULL DEFAULT 'متغير',
  amount numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'نقدي',
  notes text,
  auto_deduct_enabled boolean NOT NULL DEFAULT false,
  auto_deduct_day integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.expenses FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TABLE IF NOT EXISTS public.expense_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  deduction_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'مكتمل',
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expense_deductions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.expense_deductions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.expense_deductions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Auto-deduct cron: daily check for fixed expenses with auto_deduct_day = today, no deduction yet this month
CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE OR REPLACE FUNCTION public.run_auto_expense_deductions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.expense_deductions (expense_id, deduction_date, amount, status)
  SELECT e.id, CURRENT_DATE, e.amount, 'مكتمل'
  FROM public.expenses e
  WHERE e.expense_type = 'ثابت'
    AND e.auto_deduct_enabled = true
    AND e.auto_deduct_day = EXTRACT(DAY FROM CURRENT_DATE)::int
    AND NOT EXISTS (
      SELECT 1 FROM public.expense_deductions d
      WHERE d.expense_id = e.id
        AND date_trunc('month', d.deduction_date) = date_trunc('month', CURRENT_DATE)
    );
END;
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
SELECT cron.schedule(
  'auto-expense-deductions-daily',
  '0 1 * * *',
  $$SELECT public.run_auto_expense_deductions();$$
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260510205210_10150c8b-4e67-491c-ae27-1ceb0579f49e.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260510205210_10150c8b-4e67-491c-ae27-1ceb0579f49e.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS travel_date date, ADD COLUMN IF NOT EXISTS airline text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260510205904_d2b4f871-b52c-4cc9-95c4-0a12bc1d5dcd.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260510205904_d2b4f871-b52c-4cc9-95c4-0a12bc1d5dcd.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS authority text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260511131329_d34404f4-68e2-40f3-b07a-e9cee2ee819e.sql  (21 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260511131329_d34404f4-68e2-40f3-b07a-e9cee2ee819e.sql'; END $$;

DO $mig$
BEGIN
-- Roles enum
create type public.app_role as enum ('admin', 'manager', 'user');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
alter table public.profiles enable row level security;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
alter table public.user_roles enable row level security;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Has role function
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Settings
create table public.app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
alter table public.app_settings enable row level security;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Activity logs
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null,
  entity text,
  details jsonb,
  created_at timestamptz not null default now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
alter table public.activity_logs enable row level security;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Auto-create profile trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- RLS policies
create policy "profiles self read" on public.profiles for select to authenticated using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "profiles self update" on public.profiles for update to authenticated using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "profiles admin insert" on public.profiles for insert to authenticated with check (public.has_role(auth.uid(), 'admin') or auth.uid() = id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "user_roles read auth" on public.user_roles for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "user_roles admin manage" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "settings read auth" on public.app_settings for select to authenticated using (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "settings admin write" on public.app_settings for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "activity read admin" on public.activity_logs for select to authenticated using (public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "activity insert auth" on public.activity_logs for insert to authenticated with check (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260511132417_c1f6a8e7-4dd3-46f5-8c17-86ae679c7e45.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260511132417_c1f6a8e7-4dd3-46f5-8c17-86ae679c7e45.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS agent_id uuid,
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS invited_by uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$function$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260511142441_aab64e3d-0592-48ef-a3cd-748d963a8cc6.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260511142441_aab64e3d-0592-48ef-a3cd-748d963a8cc6.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_accepted boolean NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Existing rows that already signed in are considered accepted
UPDATE public.profiles p SET invite_accepted = true
  WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id AND u.last_sign_in_at IS NOT NULL);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260511151543_5c5c850c-e5dd-43e7-b274-bd4a6c072b32.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260511151543_5c5c850c-e5dd-43e7-b274-bd4a6c072b32.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
  END IF;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260511163603_b7f75435-7bd7-4539-8027-84f2a06299e0.sql  (7 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260511163603_b7f75435-7bd7-4539-8027-84f2a06299e0.sql'; END $$;

DO $mig$
BEGIN
CREATE TABLE public.system_dropdown_options (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  value text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, value)
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.system_dropdown_options ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "dropdown read auth" ON public.system_dropdown_options
  FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "dropdown admin write" ON public.system_dropdown_options
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX idx_system_dropdown_options_cat ON public.system_dropdown_options(category, is_active);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
INSERT INTO public.system_dropdown_options (category, value) VALUES
  ('destination','بنغازي'),('destination','مصراته'),('destination','طرابلس'),
  ('authority','مطار برج العرب'),('authority','مطار القاهرة'),('authority','جمرك بري'),
  ('airline','برنيق'),('airline','بنغازي'),('airline','البرج'),
  ('service_type','تذاكر طيران'),('service_type','موافقة أمنية'),('service_type','استثمار عسكري')
ON CONFLICT (category, value) DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_dropdown_options;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260511175749_5fc10bd5-ad8a-4164-a565-19dcc013f3b9.sql  (7 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260511175749_5fc10bd5-ad8a-4164-a565-19dcc013f3b9.sql'; END $$;

DO $mig$
BEGIN
-- Clean invalid dropdown option rows only
DELETE FROM public.system_dropdown_options
WHERE category IS NULL
   OR btrim(category) = ''
   OR category NOT IN ('authority', 'destination', 'airline', 'service_type')
   OR value IS NULL
   OR btrim(value) = '';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Normalize existing values without changing business records
UPDATE public.system_dropdown_options
SET category = btrim(category), value = btrim(value), is_active = COALESCE(is_active, true)
WHERE category <> btrim(category)
   OR value <> btrim(value)
   OR is_active IS NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS validate_system_dropdown_option_trigger ON public.system_dropdown_options;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER validate_system_dropdown_option_trigger
BEFORE INSERT OR UPDATE ON public.system_dropdown_options
FOR EACH ROW
EXECUTE FUNCTION public.validate_system_dropdown_option();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE UNIQUE INDEX IF NOT EXISTS system_dropdown_options_category_value_unique
ON public.system_dropdown_options (category, value);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260512223829_9c57e9cc-8e00-4487-a9f0-f8a1b7bf18ce.sql  (17 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260512223829_9c57e9cc-8e00-4487-a9f0-f8a1b7bf18ce.sql'; END $$;

DO $mig$
BEGIN
-- 1) Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('system-backups', 'system-backups', false)
ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2) Storage RLS: admins only
DROP POLICY IF EXISTS "system_backups admin read" ON storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "system_backups admin write" ON storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "system_backups admin update" ON storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "system_backups admin delete" ON storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "system_backups admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "system_backups admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "system_backups admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "system_backups admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'system-backups' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) Backup logs table
CREATE TABLE IF NOT EXISTS public.backup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type TEXT NOT NULL,            -- daily | weekly | monthly | manual | emergency | restore
  file_path TEXT,
  file_size BIGINT,
  status TEXT NOT NULL DEFAULT 'success', -- success | failed | running
  failure_reason TEXT,
  restore_date TIMESTAMPTZ,
  restored_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.backup_logs ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "backup_logs admin all" ON public.backup_logs;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "backup_logs admin all" ON public.backup_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON public.backup_logs (created_at DESC);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_backup_logs_type ON public.backup_logs (backup_type);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 4) Schedule cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260513175524_5e134434-5681-4171-b999-ce733ae72d2c.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260513175524_5e134434-5681-4171-b999-ce733ae72d2c.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260513190827_9d5b5893-9547-4bab-9046-42b3b44533fa.sql  (9 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260513190827_9d5b5893-9547-4bab-9046-42b3b44533fa.sql'; END $$;

DO $mig$
BEGIN
-- Create public branding bucket for company logos
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do update set public = true;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Public read
drop policy if exists "company-assets public read" on storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "company-assets public read"
on storage.objects for select
using (bucket_id = 'company-assets');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Admin write/update/delete
drop policy if exists "company-assets admin insert" on storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "company-assets admin insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
drop policy if exists "company-assets admin update" on storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "company-assets admin update"
on storage.objects for update to authenticated
using (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role))
with check (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
drop policy if exists "company-assets admin delete" on storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
create policy "company-assets admin delete"
on storage.objects for delete to authenticated
using (bucket_id = 'company-assets' and has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260515172131_b7fb1dc7-9302-416d-a0aa-3e55d78be98f.sql  (4 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260515172131_b7fb1dc7-9302-416d-a0aa-3e55d78be98f.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.user_roles REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260515174556_50b3457a-1e8f-4f30-a7a6-400d296a263a.sql  (12 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260515174556_50b3457a-1e8f-4f30-a7a6-400d296a263a.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.issuing_companies ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investors ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchant_cash_collections ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investor_transactions ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expense_deductions ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260515200632_7613e0a8-b120-4444-9435-7fbdf7772c84.sql  (14 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260515200632_7613e0a8-b120-4444-9435-7fbdf7772c84.sql'; END $$;

DO $mig$
BEGIN
-- Ensure full row data is sent on UPDATE/DELETE for realtime subscribers
ALTER TABLE public.agents REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.flights REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.issuing_companies REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchants REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchant_cash_collections REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investors REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investor_transactions REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expenses REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expense_deductions REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.system_dropdown_options REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Add tables to the realtime publication so all clients receive INSERT/UPDATE/DELETE events
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agents','flights','approvals','transactions','issuing_companies',
    'company_transactions','merchants','merchant_cash_collections',
    'investors','investor_transactions','expenses','expense_deductions',
    'system_dropdown_options'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260516114000_5e3d7a5f-d4ed-4377-94fb-6e2efe547bb3.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260516114000_5e3d7a5f-d4ed-4377-94fb-6e2efe547bb3.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'security_approval';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_approvals_service_type ON public.approvals(service_type);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260516122211_9edb0acb-5244-4bc2-9183-04253353a845.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260516122211_9edb0acb-5244-4bc2-9183-04253353a845.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_value numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_value numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS source_service_type text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS source_service_type text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_transactions_source_service_id ON public.transactions (source_service_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_company_transactions_source_service_id ON public.company_transactions (source_service_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260516154933_e924610c-73aa-4ec7-b83a-5db7bdce1331.sql  (5 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260516154933_e924610c-73aa-4ec7-b83a-5db7bdce1331.sql'; END $$;

DO $mig$
BEGIN
CREATE TABLE public.usd_treasury_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL DEFAULT CURRENT_DATE,
  type text NOT NULL DEFAULT 'conversion',
  egp_amount numeric NOT NULL DEFAULT 0,
  usd_amount numeric NOT NULL DEFAULT 0,
  exchange_rate numeric,
  company_id uuid,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.usd_treasury_transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.usd_treasury_transactions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.usd_treasury_transactions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS usd_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate_used numeric,
  ADD COLUMN IF NOT EXISTS payment_currency text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260516161223_d415d2c5-22b1-46ec-8127-9930a92ff2ff.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260516161223_d415d2c5-22b1-46ec-8127-9930a92ff2ff.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.usd_treasury_transactions
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS merchant_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260516162906_5aaa25c9-e0fe-49fc-8025-76c80e1f9fe4.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260516162906_5aaa25c9-e0fe-49fc-8025-76c80e1f9fe4.sql'; END $$;

DO $mig$
BEGIN
CREATE TABLE public.agent_service_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  service_type text NOT NULL,
  company_price numeric NOT NULL DEFAULT 0,
  agent_price numeric NOT NULL DEFAULT 0,
  company_percentage numeric NOT NULL DEFAULT 0,
  company_profit_value numeric NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, service_type)
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.agent_service_pricing ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "open_all" ON public.agent_service_pricing FOR ALL USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX idx_agent_service_pricing_agent ON public.agent_service_pricing(agent_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Snapshot fields on flights
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS company_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_profit_value numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Snapshot fields on approvals
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS company_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_profit_value numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260517095940_c19a2e94-6f7e-4c29-a9dd-c9e792bacb75.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260517095940_c19a2e94-6f7e-4c29-a9dd-c9e792bacb75.sql'; END $$;

DO $mig$
BEGIN
-- Lock down all currently public tables to authenticated users only
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agents','agent_service_pricing','approvals','flights','transactions',
    'company_transactions','investors','investor_transactions','merchants',
    'merchant_cash_collections','issuing_companies','expenses','expense_deductions',
    'usd_treasury_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS open_all ON public.%I', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_auth_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t||'_auth_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t||'_auth_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)', t||'_auth_delete', t);
  END LOOP;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260517100147_84d3183a-3b66-4091-b48e-71f4695d1b0f.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260517100147_84d3183a-3b66-4091-b48e-71f4695d1b0f.sql'; END $$;

DO $mig$
BEGIN
-- user_roles: explicit admin-only INSERT/UPDATE/DELETE; keep existing SELECT
DROP POLICY IF EXISTS "user_roles admin manage" ON public.user_roles;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "user_roles admin insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "user_roles admin update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "user_roles admin delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- activity_logs: bind inserts to current user
DROP POLICY IF EXISTS "activity insert auth" ON public.activity_logs;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "activity insert self" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260517160717_f0c7c767-0a93-4a3f-b088-d39628f35300.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260517160717_f0c7c767-0a93-4a3f-b088-d39628f35300.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS funding_source text,
  ADD COLUMN IF NOT EXISTS merchant_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS usd_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expense_deductions
  ADD COLUMN IF NOT EXISTS funding_source text,
  ADD COLUMN IF NOT EXISTS merchant_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS usd_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260517163502_9f66ffd9-097d-4a3f-9c52-fbc83b2d76e2.sql  (4 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260517163502_9f66ffd9-097d-4a3f-9c52-fbc83b2d76e2.sql'; END $$;

DO $mig$
BEGIN
CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type text NOT NULL,
  target_table text NOT NULL,
  file_name text,
  user_email text,
  rows_inserted integer NOT NULL DEFAULT 0,
  inserted_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "import_batches admin all" ON public.import_batches
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX idx_import_batches_created ON public.import_batches(created_at DESC);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260518153240_50f4d7dd-4058-4a6d-930c-cddb5bf37e71.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260518153240_50f4d7dd-4058-4a6d-930c-cddb5bf37e71.sql'; END $$;

DO $mig$
BEGIN
-- Add super admin flag to profiles for "owner" bypass of settings permissions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Seed: mark current admins as super admins to avoid lockout
UPDATE public.profiles p
SET is_super_admin = true
WHERE EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = p.id AND ur.role = 'admin'
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260518161038_e1e5c4f3-0a04-4570-9deb-877f1fe6c621.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260518161038_e1e5c4f3-0a04-4570-9deb-877f1fe6c621.sql'; END $$;

DO $mig$
BEGIN
-- Enable realtime for all core tables + ensure full row payload on update/delete
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'agents','issuing_companies','merchants','flights','approvals',
    'transactions','company_transactions','investors','investor_transactions',
    'expenses','expense_deductions','merchant_cash_collections',
    'agent_service_pricing','profiles','user_roles','app_settings',
    'system_dropdown_options','activity_logs','backup_logs','import_batches'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260524185727_7b9aefd1-3089-47e4-b4b3-7b1c38d0f869.sql  (23 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260524185727_7b9aefd1-3089-47e4-b4b3-7b1c38d0f869.sql'; END $$;

DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "submissions_auth_select" ON public.submissions
  FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "submissions_auth_insert" ON public.submissions
  FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "submissions_auth_update" ON public.submissions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "submissions_auth_delete" ON public.submissions
  FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "executions_auth_select" ON public.executions
  FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "executions_auth_insert" ON public.executions
  FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "executions_auth_update" ON public.executions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "executions_auth_delete" ON public.executions
  FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS trg_submissions_touch ON public.submissions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_submissions_touch BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS trg_executions_touch ON public.executions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_executions_touch BEFORE UPDATE ON public.executions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) Extend system_dropdown_options to accept new categories
ALTER TABLE public.system_dropdown_options
  DROP CONSTRAINT IF EXISTS system_dropdown_options_category_check;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 5) Realtime
ALTER TABLE public.submissions REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions  REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.executions;  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260525151755_4d3ad92a-0c4c-4af6-9fcf-0eaadd36e32d.sql  (10 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260525151755_4d3ad92a-0c4c-4af6-9fcf-0eaadd36e32d.sql'; END $$;

DO $mig$
BEGIN
-- 1) Fix mutable search_path on touch_updated_at
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2) Restrict agent_service_pricing writes to admins
DROP POLICY IF EXISTS agent_service_pricing_auth_insert ON public.agent_service_pricing;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS agent_service_pricing_auth_update ON public.agent_service_pricing;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS agent_service_pricing_auth_delete ON public.agent_service_pricing;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY agent_service_pricing_admin_insert
  ON public.agent_service_pricing FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY agent_service_pricing_admin_update
  ON public.agent_service_pricing FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY agent_service_pricing_admin_delete
  ON public.agent_service_pricing FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS prevent_profile_privilege_escalation_trg ON public.profiles;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER prevent_profile_privilege_escalation_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260525155046_ffba2d86-d902-4a14-b9ee-f1b88792288e.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260525155046_ffba2d86-d902-4a14-b9ee-f1b88792288e.sql'; END $$;

DO $mig$
BEGIN
-- 1) Extend the dropdown validation trigger to allow the two new categories
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
    'submission_notes','airport'
  ) THEN
    RAISE EXCEPTION 'Invalid dropdown category: %', NEW.category;
  END IF;

  IF NEW.value = '' THEN
    RAISE EXCEPTION 'Dropdown value cannot be empty';
  END IF;

  RETURN NEW;
END; $function$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2) Seed default values for each of the six requested lists.
--    Only insert when the (category, value) pair is missing so this is idempotent
--    and does NOT overwrite anything an admin has already added or disabled.
WITH defaults(category, value) AS (
  VALUES
    -- الحالة (status used by both submissions & executions)
    ('submission_status','بطيء'),
    ('submission_status','سريع'),
    ('submission_status','رفض أمني'),
    ('execution_status','بطيء'),
    ('execution_status','سريع'),
    ('execution_status','رفض أمني'),

    -- ملاحظات
    ('submission_notes','سيدات'),
    ('submission_notes','رضيع'),
    ('submission_notes','طفل تحت 8'),
    ('submission_notes','طفل تحت 12'),

    -- الوجهة
    ('destination','بنغازي'),
    ('destination','طرابلس'),
    ('destination','مصراته'),
    ('destination','سبها'),

    -- الطيران
    ('airline','العراق'),
    ('airline','البرنيق'),
    ('airline','الليبية'),
    ('airline','إير كايرو'),
    ('airline','تاج'),
    ('airline','مصر للطيران'),
    ('airline','الإفريقية'),

    -- المطار
    ('airport','برج العرب'),
    ('airport','القاهرة'),

    -- الخدمة (used by submissions services + execution service_kind)
    ('service_kind','موافقة أمنية'),
    ('service_kind','تذكرة'),
    ('service_kind','استثمار'),
    ('service_kind','استثمار بري'),
    ('service_kind','تذكرة واستثمار'),
    ('service_kind','بنغازي شغل كامل'),
    ('service_kind','طرابلس شغل كامل'),
    ('service_kind','مصراته شغل كامل'),
    ('service_kind','سبها شغل كامل'),
    ('service_kind','بري شغل كامل'),
    ('service_kind','نقل بري (طبرق واجدابيا)'),
    ('service_kind','نقل طرابلس'),
    ('service_kind','نقل مصراته'),
    ('service_kind','نقل ........'),
    ('service_kind','موافقة واستثمار بري'),
    ('service_kind','تأشيرة طرابلس'),
    ('service_kind','مصراته تنسيق'),
    ('service_kind','خدمات أخرى'),
    ('service_kind','نقل عن طريق سبها')
)
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT d.category, d.value, true
FROM defaults d
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options o
  WHERE o.category = d.category AND o.value = d.value
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260525160624_e53dc0b0-c452-4b4b-8b89-d7b4b9c73b8c.sql  (9 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260525160624_e53dc0b0-c452-4b4b-8b89-d7b4b9c73b8c.sql'; END $$;

DO $mig$
BEGIN
-- 1) Add operation_status columns
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS operation_status text NOT NULL DEFAULT 'قيد المتابعة';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS operation_status text NOT NULL DEFAULT 'قيد التنفيذ';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2) Migrate workflow values out of status into operation_status (preserve data)
UPDATE public.submissions
SET operation_status = status,
    status = 'بطيء'
WHERE status IN ('قيد المتابعة','جاهز للتنفيذ','ملغي','مؤجل','جاهز','منفذ','قيد التنفيذ');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.executions
SET operation_status = status,
    status = 'بطيء'
WHERE status IN ('قيد التنفيذ','منفذ','ملغي','مؤجل','جاهز','جاهز للتنفيذ','قيد المتابعة');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) Update column defaults: status now means approval status
ALTER TABLE public.submissions ALTER COLUMN status SET DEFAULT 'بطيء';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions  ALTER COLUMN status SET DEFAULT 'بطيء';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260525191723_d9d201d1-1760-415a-8558-fc5171fc3a05.sql  (8 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260525191723_d9d201d1-1760-415a-8558-fc5171fc3a05.sql'; END $$;

DO $mig$
BEGIN
-- Add approval_company_id linking to issuing_companies for submissions and executions
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS approval_company_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS approval_company_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_submissions_approval_company ON public.submissions(approval_company_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_executions_approval_company ON public.executions(approval_company_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Backfill submissions.approval_company_id from existing approval_authority text (match by company_name)
UPDATE public.submissions s
SET approval_company_id = ic.id
FROM public.issuing_companies ic
WHERE s.approval_company_id IS NULL
  AND s.approval_authority IS NOT NULL
  AND btrim(s.approval_authority) <> ''
  AND lower(btrim(ic.company_name)) = lower(btrim(s.approval_authority));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS trg_prevent_issuing_company_delete ON public.issuing_companies;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_prevent_issuing_company_delete
BEFORE DELETE ON public.issuing_companies
FOR EACH ROW EXECUTE FUNCTION public.prevent_issuing_company_delete_if_used();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260529011354_138e6380-0fba-4914-90eb-ab350fbd1473.sql  (4 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260529011354_138e6380-0fba-4914-90eb-ab350fbd1473.sql'; END $$;

DO $mig$
BEGIN
-- Change source_service_id from uuid to text to support composite per-service link IDs
-- (format: `${executionId}::${index}`). This also restores correct behavior for
-- delete-by-prefix in execution financial posting.

ALTER TABLE public.transactions
  ALTER COLUMN source_service_id TYPE text USING source_service_id::text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions
  ALTER COLUMN source_service_id TYPE text USING source_service_id::text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_transactions_source_service_id
  ON public.transactions (source_service_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_company_transactions_source_service_id
  ON public.company_transactions (source_service_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260601223149_69f897fc-eb55-479c-a6cf-c698d6426c7a.sql  (4 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260601223149_69f897fc-eb55-479c-a6cf-c698d6426c7a.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.profiles DISABLE TRIGGER USER;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.profiles SET is_super_admin = true WHERE email = 'mohamed112233.mm51@gmail.com';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.profiles ENABLE TRIGGER USER;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM public.profiles WHERE email = 'mohamed112233.mm51@gmail.com'
ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260601224019_9ae02105-f9ae-4656-81fe-a8ef1a483e29.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260601224019_9ae02105-f9ae-4656-81fe-a8ef1a483e29.sql'; END $$;

DO $mig$
BEGIN
-- Enable Realtime for operational tables
-- Add tables to supabase_realtime publication so postgres_changes events are delivered
-- Set REPLICA IDENTITY FULL so UPDATE/DELETE events carry full old row

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'executions','submissions','transactions','agents','issuing_companies',
    'user_roles','profiles','system_dropdown_options',
    'flights','approvals','company_transactions','merchants',
    'merchant_cash_collections','investors','investor_transactions',
    'expenses','expense_deductions','usd_treasury_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260603200547_716f7000-00af-417a-b13a-3fb034e90d76.sql  (19 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260603200547_716f7000-00af-417a-b13a-3fb034e90d76.sql'; END $$;

DO $mig$
BEGIN
-- 1) Drop the deprecated tables (data loss confirmed by user)
DROP TABLE IF EXISTS public.flights CASCADE;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TABLE IF EXISTS public.approvals CASCADE;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Re-add only the 5 tables the user wants Realtime on
ALTER TABLE public.agents              REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.issuing_companies   REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.submissions         REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions          REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.transactions        REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.issuing_companies;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.executions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Keep system_dropdown_options on realtime — settings page needs live dropdowns
ALTER TABLE public.system_dropdown_options REPLICA IDENTITY FULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_dropdown_options;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) Update dropdown values
-- Replace 'العراق' with 'البراق'
UPDATE public.system_dropdown_options
   SET value = 'البراق'
 WHERE category = 'airline' AND value = 'العراق';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Add 'جمرك بري' to departure_from
INSERT INTO public.system_dropdown_options (category, value, is_active)
SELECT 'departure_from', v, true FROM (VALUES
  ('مطار القاهرة'), ('برج العرب'), ('جمرك بري')
) AS x(v)
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_dropdown_options s
   WHERE s.category = 'departure_from' AND s.value = x.v
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 4) Drop validation trigger that referenced approvals (it auto-disables companies; harmless to keep, leave it).;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260604173046_88ac06e5-e6f3-4f23-ba20-c2c2f96e70c2.sql  (24 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260604173046_88ac06e5-e6f3-4f23-ba20-c2c2f96e70c2.sql'; END $$;

DO $mig$
BEGIN
-- Cash boxes: one wallet per currency (EGP / USD / LYD)
CREATE TABLE public.cash_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('EGP','USD','LYD')),
  balance numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_boxes TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.cash_boxes TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.cash_boxes ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY cash_boxes_auth_select ON public.cash_boxes FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY cash_boxes_auth_insert ON public.cash_boxes FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY cash_boxes_auth_update ON public.cash_boxes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY cash_boxes_auth_delete ON public.cash_boxes FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER cash_boxes_touch_updated_at
  BEFORE UPDATE ON public.cash_boxes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Seed default cash boxes
INSERT INTO public.cash_boxes (name, currency, balance) VALUES
  ('الخزينة الرئيسية - جنيه', 'EGP', 0),
  ('الخزينة الرئيسية - دولار', 'USD', 0),
  ('الخزينة الرئيسية - دينار ليبي', 'LYD', 0);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Payment splits: multi-line allocation of a single transaction payment
CREATE TABLE public.payment_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  method text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('EGP','USD','LYD')),
  cash_box_id uuid REFERENCES public.cash_boxes(id) ON DELETE SET NULL,
  amount numeric NOT NULL DEFAULT 0,
  exchange_rate numeric,
  egp_equivalent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX payment_splits_transaction_id_idx ON public.payment_splits(transaction_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX payment_splits_cash_box_id_idx ON public.payment_splits(cash_box_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_splits TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.payment_splits TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY payment_splits_auth_select ON public.payment_splits FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY payment_splits_auth_insert ON public.payment_splits FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY payment_splits_auth_update ON public.payment_splits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY payment_splits_auth_delete ON public.payment_splits FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Keep cash_boxes.balance in sync with payment_splits in the matching currency
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) + COALESCE(NEW.amount, 0),
            updated_at = now()
      WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) - COALESCE(OLD.amount, 0),
            updated_at = now()
      WHERE id = OLD.cash_box_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) - COALESCE(OLD.amount, 0),
            updated_at = now()
      WHERE id = OLD.cash_box_id;
    END IF;
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
        SET balance = COALESCE(balance, 0) + COALESCE(NEW.amount, 0),
            updated_at = now()
      WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER payment_splits_balance_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_splits
  FOR EACH ROW EXECUTE FUNCTION public.apply_payment_split_to_cash_box();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Realtime for live ledger + wallet updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_boxes;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_splits;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260604200146_7a91992d-0f75-40a9-aa5e-c96167b116fe.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260604200146_7a91992d-0f75-40a9-aa5e-c96167b116fe.sql'; END $$;

DO $mig$
BEGIN
INSERT INTO public.cash_boxes (name, currency, balance, is_active)
SELECT v.name, 'EGP', 0, true
FROM (VALUES ('خزينة إنستا الشركة'), ('خزينة نقدي الشركة')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.cash_boxes c WHERE c.name = v.name);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260605175937_95cead5a-bb93-4048-811c-b68c9e9bf359.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260605175937_95cead5a-bb93-4048-811c-b68c9e9bf359.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.payment_splits
  ADD COLUMN IF NOT EXISTS gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_commission_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_commission_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260607180141_3e633fdc-a0fa-4aef-89fd-c401b7c4db7f.sql  (4 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260607180141_3e633fdc-a0fa-4aef-89fd-c401b7c4db7f.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.merchant_cash_collections ADD COLUMN IF NOT EXISTS expense_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_mcc_expense_id ON public.merchant_cash_collections(expense_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.usd_treasury_transactions ADD COLUMN IF NOT EXISTS expense_id uuid;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_usd_expense_id ON public.usd_treasury_transactions(expense_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260608151222_1ae1f402-a822-4566-89d4-33f98d8ff29f.sql  (19 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260608151222_1ae1f402-a822-4566-89d4-33f98d8ff29f.sql'; END $$;

DO $mig$
BEGIN
CREATE TABLE public.currency_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  notes text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT SELECT, INSERT, UPDATE, DELETE ON public.currency_suppliers TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.currency_suppliers TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_suppliers ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth read currency_suppliers" ON public.currency_suppliers
  FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth insert currency_suppliers" ON public.currency_suppliers
  FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth update currency_suppliers" ON public.currency_suppliers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth delete currency_suppliers" ON public.currency_suppliers
  FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_currency_suppliers_updated_at
  BEFORE UPDATE ON public.currency_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TABLE public.currency_supplier_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.currency_suppliers(id) ON DELETE CASCADE,
  tx_date date NOT NULL DEFAULT CURRENT_DATE,
  tx_type text NOT NULL CHECK (tx_type IN ('شراء عملة','بيع عملة')),
  bought_currency text NOT NULL,
  bought_amount numeric NOT NULL DEFAULT 0,
  sold_currency text NOT NULL,
  sold_amount numeric NOT NULL DEFAULT 0,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT SELECT, INSERT, UPDATE, DELETE ON public.currency_supplier_transactions TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.currency_supplier_transactions TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth read cs_tx" ON public.currency_supplier_transactions
  FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth insert cs_tx" ON public.currency_supplier_transactions
  FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth update cs_tx" ON public.currency_supplier_transactions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "auth delete cs_tx" ON public.currency_supplier_transactions
  FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_cs_tx_updated_at
  BEFORE UPDATE ON public.currency_supplier_transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX idx_cs_tx_supplier ON public.currency_supplier_transactions(supplier_id, tx_date DESC);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260608155935_9fdb0d26-6b64-427c-8b9c-f30dd980b74c.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260608155935_9fdb0d26-6b64-427c-8b9c-f30dd980b74c.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions 
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS payment_splits jsonb NOT NULL DEFAULT '[]'::jsonb;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260611015756_e2ae525c-f543-48a6-80bf-13851516baf5.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260611015756_e2ae525c-f543-48a6-80bf-13851516baf5.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS approval_validity_enabled boolean NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
INSERT INTO public.app_settings (key, value)
VALUES ('approval_validity_days', '{"v": 30}'::jsonb)
ON CONFLICT (key) DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260611180712_27cbc28f-88d7-48ff-b1b0-f6237ffa8337.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260611180712_27cbc28f-88d7-48ff-b1b0-f6237ffa8337.sql'; END $$;

DO $mig$
BEGIN
CREATE UNIQUE INDEX IF NOT EXISTS transactions_submission_fine_unique
ON public.transactions (source_service_id)
WHERE source_service_type = 'submission_fine';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260611201954_c4b0c5bd-a467-4656-986f-1f523f58cb8d.sql  (3 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260611201954_c4b0c5bd-a467-4656-986f-1f523f58cb8d.sql'; END $$;

DO $mig$
BEGIN
CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS submissions_passenger_name_trgm ON public.submissions USING gin (passenger_name gin_trgm_ops);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS executions_passenger_name_trgm ON public.executions USING gin (passenger_name gin_trgm_ops);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260612164747_81417dd6-6a4b-48d3-9cf2-7f5c12dce248.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260612164747_81417dd6-6a4b-48d3-9cf2-7f5c12dce248.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.issuing_companies
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260613114725_3b2ba53c-9a05-48dc-93af-cfcd0b0128fe.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260613114725_3b2ba53c-9a05-48dc-93af-cfcd0b0128fe.sql'; END $$;

DO $mig$
BEGIN
-- Add passenger_type to submissions and executions
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS passenger_type text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions  ADD COLUMN IF NOT EXISTS passenger_type text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Replicate approval validity fields on executions
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS approval_validity_enabled boolean DEFAULT false;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.executions ADD COLUMN IF NOT EXISTS issue_date date;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Seed default passenger types (idempotent)
INSERT INTO public.system_dropdown_options (category, value, is_active)
VALUES
  ('passenger_type','سيدات', true),
  ('passenger_type','رضع', true),
  ('passenger_type','طفل تحت 8', true),
  ('passenger_type','طفل تحت 12', true)
ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260618234820_52e16a11-5bcf-4e4f-bab1-85d6ddaa3925.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260618234820_52e16a11-5bcf-4e4f-bab1-85d6ddaa3925.sql'; END $$;

DO $mig$
BEGIN
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Trusted server contexts (service_role / no auth.uid) and admins bypass the guard.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
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
$function$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260618235828_a6e4f1f2-8d3a-4204-a380-9d5e6afe7e79.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260618235828_a6e4f1f2-8d3a-4204-a380-9d5e6afe7e79.sql'; END $$;

DO $mig$
BEGIN
-- Extend backup_logs to match the spec required by the user (backup_name, file_url, completed_at, error_message)
-- Keep existing columns for back-compat.

ALTER TABLE public.backup_logs
  ADD COLUMN IF NOT EXISTS backup_name text,
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Widen status default & allow new states; we don't enforce a CHECK to avoid breaking old rows.
ALTER TABLE public.backup_logs ALTER COLUMN status DROP NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.backup_logs ALTER COLUMN status SET DEFAULT 'pending';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Backfill error_message from failure_reason if needed.
UPDATE public.backup_logs SET error_message = failure_reason WHERE error_message IS NULL AND failure_reason IS NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Tighten RLS: admin-only (policy already exists, but re-affirm grants).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_logs TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.backup_logs TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260619000219_425639e8-05fe-4f85-a930-d46e0cd4a82c.sql  (3 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260619000219_425639e8-05fe-4f85-a930-d46e0cd4a82c.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.backup_logs
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Backfill started_at from created_at for old rows
UPDATE public.backup_logs SET started_at = created_at WHERE started_at IS NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_backup_logs_trigger_type ON public.backup_logs(trigger_type);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260619150455_c484197b-0fa8-4e20-a5ee-88edca0421f5.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260619150455_c484197b-0fa8-4e20-a5ee-88edca0421f5.sql'; END $$;

DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260619151115_7b2aedf6-3586-46d8-9a2a-1138c4089258.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260619151115_7b2aedf6-3586-46d8-9a2a-1138c4089258.sql'; END $$;

DO $mig$
BEGIN
CREATE OR REPLACE FUNCTION public.prevent_issuing_company_delete_if_used()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  used_count integer := 0;
BEGIN
  -- Only the trusted backend maintenance client may physically delete companies
  -- after dependent operational tables have been wiped.
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260626173246_f8cfc2ba-d9f3-4d80-99a8-645c6bf900c7.sql  (21 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260626173246_f8cfc2ba-d9f3-4d80-99a8-645c6bf900c7.sql'; END $$;

DO $mig$
BEGIN
-- 1) Agents tier column
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'A';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) Seed default tiers (safe if exists)
INSERT INTO public.system_dropdown_options (category, value, is_active)
VALUES ('agent_tier','A',true), ('agent_tier','B',true), ('agent_tier','C',true)
ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_cpr_company ON public.company_pricing_rules(company_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_cpr_lookup ON public.company_pricing_rules(company_id, service_type, agent_tier);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_pricing_rules TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.company_pricing_rules TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_pricing_rules ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "cpr_select" ON public.company_pricing_rules;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "cpr_insert" ON public.company_pricing_rules;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "cpr_update" ON public.company_pricing_rules;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "cpr_delete" ON public.company_pricing_rules;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "cpr_select" ON public.company_pricing_rules FOR SELECT TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "cpr_insert" ON public.company_pricing_rules FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "cpr_update" ON public.company_pricing_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "cpr_delete" ON public.company_pricing_rules FOR DELETE TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS trg_cpr_calc ON public.company_pricing_rules;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_cpr_calc
  BEFORE INSERT OR UPDATE ON public.company_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.calc_company_pricing_agent_price();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 6) Drop old pricing table (user confirmed)
DROP TABLE IF EXISTS public.agent_service_pricing CASCADE;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260627151642_bb9a7611-e1e7-4938-8177-6ba262e558e0.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260627151642_bb9a7611-e1e7-4938-8177-6ba262e558e0.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions ALTER COLUMN agent_id DROP NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260628201640_25c15a0c-8152-4767-a405-fbac7ba0f382.sql  (7 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260628201640_25c15a0c-8152-4767-a405-fbac7ba0f382.sql'; END $$;

DO $mig$
BEGIN
-- =========================================================
-- 1) Replace "USING (true)" / "WITH CHECK (true)" with auth.uid() IS NOT NULL
--    on all flagged INSERT/UPDATE/DELETE policies.
-- =========================================================

DO $$
DECLARE
  r RECORD;
  new_qual text;
  new_chk  text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('INSERT','UPDATE','DELETE')
      AND ((qual = 'true') OR (with_check = 'true'))
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    IF r.cmd = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL)',
        r.policyname, r.schemaname, r.tablename
      );
    ELSIF r.cmd = 'DELETE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL)',
        r.policyname, r.schemaname, r.tablename
      );
    ELSIF r.cmd = 'UPDATE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
        r.policyname, r.schemaname, r.tablename
      );
    END IF;
  END LOOP;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- =========================================================
-- 2) Storage: drop the broad public SELECT (listing) policy on company-assets.
--    Public bucket files remain reachable through the /object/public/ CDN URL
--    without RLS, so logos still load on the login page.
-- =========================================================
DROP POLICY IF EXISTS "company-assets public read" ON storage.objects;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- =========================================================
-- 3) Lock down SECURITY DEFINER functions that should never be called
--    directly by clients. Triggers run as table owner and ignore EXECUTE
--    grants, so revoking is safe.
-- =========================================================
REVOKE ALL ON FUNCTION public.handle_new_user()                      FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
REVOKE ALL ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
REVOKE ALL ON FUNCTION public.run_auto_expense_deductions()          FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- has_role is intentionally callable by signed-in users (used in RLS expressions).
REVOKE ALL  ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260628234514_600c847b-55f9-4836-884c-d6d9a7036787.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260628234514_600c847b-55f9-4836-884c-d6d9a7036787.sql'; END $$;

DO $mig$
BEGIN
INSERT INTO public.system_dropdown_options (category, value, is_active) VALUES
  ('agent_tier', 'A', true),
  ('agent_tier', 'B', true),
  ('agent_tier', 'C', true),
  ('airline', 'إير كايرو', true),
  ('airline', 'الأفريقية', true),
  ('airline', 'البراق', true),
  ('airline', 'البرنيق', true),
  ('airline', 'الليبية', true),
  ('airline', 'تاج', true),
  ('airline', 'مصر للطيران', true),
  ('airport', 'القاهرة', true),
  ('airport', 'برج العرب', true),
  ('authority', 'جمرك بري', true),
  ('authority', 'مطار القاهرة', true),
  ('authority', 'مطار برج العرب', true),
  ('departure_from', 'جمرك بري', true),
  ('departure_from', 'مطار القاهرة', true),
  ('departure_from', 'مطار برج العرب', true),
  ('destination', 'بنغازي', true),
  ('destination', 'سبها', true),
  ('destination', 'طرابلس', true),
  ('destination', 'مصراته', true),
  ('execution_status', 'بطيء', true),
  ('execution_status', 'رفض أمني', true),
  ('execution_status', 'سريع', true),
  ('operation_status', 'قيد التنفيذ', true),
  ('operation_status', 'ملغي', true),
  ('operation_status', 'منفذ', true),
  ('passenger_type', 'رضع', true),
  ('passenger_type', 'سيدات', true),
  ('passenger_type', 'طفل تحت 12', true),
  ('passenger_type', 'طفل تحت 8', true),
  ('service_kind', 'استثمار', true),
  ('service_kind', 'استثمار بري', true),
  ('service_kind', 'بري شغل كامل', true),
  ('service_kind', 'بنغازي شغل كامل', true),
  ('service_kind', 'تأشيرة طرابلس', true),
  ('service_kind', 'تذكرة', true),
  ('service_kind', 'تذكرة واستثمار', true),
  ('service_kind', 'خدمات أخرى', true),
  ('service_kind', 'سبها شغل كامل', true),
  ('service_kind', 'طرابلس شغل كامل', true),
  ('service_kind', 'مصراته تنسيق', true),
  ('service_kind', 'مصراته شغل كامل', true),
  ('service_kind', 'موافقة أمنية', true),
  ('service_kind', 'موافقة واستثمار بري', true),
  ('service_kind', 'نقل ........', true),
  ('service_kind', 'نقل بري (طبرق واجدابيا)', true),
  ('service_kind', 'نقل طرابلس', true),
  ('service_kind', 'نقل عن طريق سبها', true),
  ('service_kind', 'نقل مصراته', true),
  ('service_type', 'استثمار', true),
  ('service_type', 'استثمار بري', true),
  ('service_type', 'استثمار عسكري', true),
  ('service_type', 'استثمار ليبي', true),
  ('service_type', 'بري شغل كامل', true),
  ('service_type', 'بنغازي شغل كامل', true),
  ('service_type', 'تأشيرة طرابلس', true),
  ('service_type', 'تذاكر طيران', true),
  ('service_type', 'تذكرة', true),
  ('service_type', 'تذكرة طيران', true),
  ('service_type', 'تذكرة واستثمار', true),
  ('service_type', 'خدمات أخرى', true),
  ('service_type', 'سبها شغل كامل', true),
  ('service_type', 'طرابلس شغل كامل', true),
  ('service_type', 'مصراته تنسيق', true),
  ('service_type', 'مصراته شغل كامل', true),
  ('service_type', 'موافقة أمنية', true),
  ('service_type', 'موافقة واستثمار بري', true),
  ('service_type', 'نقل ........', true),
  ('service_type', 'نقل بري (طبرق واجدابيا)', true),
  ('service_type', 'نقل طرابلس', true),
  ('service_type', 'نقل عن طريق سبها', true),
  ('service_type', 'نقل مصراته', true),
  ('submission_notes', 'رضيع', true),
  ('submission_notes', 'سيدات', true),
  ('submission_notes', 'طفل تحت 12', true),
  ('submission_notes', 'طفل تحت 8', true),
  ('submission_status', 'بطيء', true),
  ('submission_status', 'رفض أمني', true),
  ('submission_status', 'سريع', true)
ON CONFLICT (category, value) DO NOTHING;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260701165416_fafbad82-2838-417f-8669-0a0a9232f8e2.sql  (10 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260701165416_fafbad82-2838-417f-8669-0a0a9232f8e2.sql'; END $$;

DO $mig$
BEGIN
-- 1) Extend payment_splits schema
ALTER TABLE public.payment_splits
  ALTER COLUMN transaction_id DROP NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.payment_splits
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in',
  ADD COLUMN IF NOT EXISTS source_table TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_splits_direction_check'
  ) THEN
    ALTER TABLE public.payment_splits
      ADD CONSTRAINT payment_splits_direction_check CHECK (direction IN ('in','out'));
  END IF;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS payment_splits_source_idx
  ON public.payment_splits (source_table, source_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Existing splits are all agent receipts (direction 'in' by default). Tag source.
UPDATE public.payment_splits
   SET source_table = 'transactions', source_id = transaction_id
 WHERE source_table IS NULL AND transaction_id IS NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2) Update trigger to respect direction
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
DECLARE
  sign_new int := CASE WHEN COALESCE(NEW.direction,'in') = 'out' THEN -1 ELSE 1 END;
  sign_old int := CASE WHEN COALESCE(OLD.direction,'in') = 'out' THEN -1 ELSE 1 END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * COALESCE(NEW.amount,0),
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * COALESCE(OLD.amount,0),
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * COALESCE(OLD.amount,0),
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    IF NEW.cash_box_id IS NOT NULL THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * COALESCE(NEW.amount,0),
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) Merge duplicate cash boxes (same name + currency): keep oldest, reassign splits, deactivate rest
WITH ranked AS (
  SELECT id, name, currency,
    row_number() OVER (PARTITION BY name, currency ORDER BY created_at) AS rn,
    first_value(id) OVER (PARTITION BY name, currency ORDER BY created_at
                          ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS canonical_id
  FROM public.cash_boxes
)
UPDATE public.payment_splits ps
   SET cash_box_id = r.canonical_id
  FROM ranked r
 WHERE ps.cash_box_id = r.id AND r.rn > 1;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY name, currency ORDER BY created_at) AS rn
  FROM public.cash_boxes
)
UPDATE public.cash_boxes
   SET is_active = false, updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 4) Backfill payment_splits for legacy movements written only to old columns
DO $$
DECLARE
  cash_box_id_v UUID;
  insta_box_id_v UUID;
BEGIN
  SELECT id INTO cash_box_id_v FROM public.cash_boxes
    WHERE name='خزينة نقدي الشركة' AND currency='EGP' AND is_active=true
    ORDER BY created_at LIMIT 1;
  SELECT id INTO insta_box_id_v FROM public.cash_boxes
    WHERE name='خزينة إنستا الشركة' AND currency='EGP' AND is_active=true
    ORDER BY created_at LIMIT 1;

  -- Company outflows (cash)
  IF cash_box_id_v IS NOT NULL THEN
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'company_transactions', ct.id, 'company_cash', 'EGP', cash_box_id_v,
           ct.cash_amount, ct.cash_amount, ct.cash_amount, ct.cash_amount, 'out'
      FROM public.company_transactions ct
     WHERE COALESCE(ct.cash_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='company_transactions' AND ps.source_id=ct.id
            AND ps.method='company_cash'
       );

    -- Expense deductions paid from company cash
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'expense_deductions', ed.id, 'company_cash', 'EGP', cash_box_id_v,
           ed.amount, ed.amount, ed.amount, ed.amount, 'out'
      FROM public.expense_deductions ed
     WHERE COALESCE(ed.amount,0) > 0
       AND (ed.funding_source = 'cash_company' OR ed.funding_source IS NULL)
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='expense_deductions' AND ps.source_id=ed.id
       );

    -- Agent-transaction receipts that lack any 'company_cash' split
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT t.id, 'transactions', t.id, 'company_cash', 'EGP', cash_box_id_v,
           t.cash_amount, t.cash_amount, t.cash_amount, t.cash_amount, 'in'
      FROM public.transactions t
     WHERE COALESCE(t.cash_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.transaction_id = t.id AND ps.method='company_cash'
       );
  END IF;

  IF insta_box_id_v IS NOT NULL THEN
    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'company_transactions', ct.id, 'company_instapay', 'EGP', insta_box_id_v,
           ct.instapay_amount, ct.instapay_amount, ct.instapay_amount, ct.instapay_amount, 'out'
      FROM public.company_transactions ct
     WHERE COALESCE(ct.instapay_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='company_transactions' AND ps.source_id=ct.id
            AND ps.method='company_instapay'
       );

    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT NULL, 'expense_deductions', ed.id, 'company_instapay', 'EGP', insta_box_id_v,
           ed.amount, ed.amount, ed.amount, ed.amount, 'out'
      FROM public.expense_deductions ed
     WHERE COALESCE(ed.amount,0) > 0
       AND ed.funding_source = 'insta_company'
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.source_table='expense_deductions' AND ps.source_id=ed.id
       );

    INSERT INTO public.payment_splits
      (transaction_id, source_table, source_id, method, currency, cash_box_id,
       amount, egp_equivalent, gross_amount, net_amount, direction)
    SELECT t.id, 'transactions', t.id, 'company_instapay', 'EGP', insta_box_id_v,
           t.instapay_amount, t.instapay_amount, t.instapay_amount, t.instapay_amount, 'in'
      FROM public.transactions t
     WHERE COALESCE(t.instapay_amount,0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_splits ps
          WHERE ps.transaction_id = t.id AND ps.method='company_instapay'
       );
  END IF;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 5) Recompute cash_boxes.balance from payment_splits authoritatively
UPDATE public.cash_boxes cb
   SET balance = COALESCE((
         SELECT SUM(CASE WHEN ps.direction='out' THEN -ps.amount ELSE ps.amount END)
           FROM public.payment_splits ps
          WHERE ps.cash_box_id = cb.id
       ), 0),
       updated_at = now();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260701171018_adb535fa-c482-4ec7-b268-ce1ee91fbf0d.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260701171018_adb535fa-c482-4ec7-b268-ce1ee91fbf0d.sql'; END $$;

DO $mig$
BEGIN
CREATE UNIQUE INDEX IF NOT EXISTS cash_boxes_name_currency_uniq
  ON public.cash_boxes (name, currency);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260702133056_05010ec1-50fd-4e81-a739-bb05cbc3d802.sql  (8 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260702133056_05010ec1-50fd-4e81-a739-bb05cbc3d802.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchant_cash_collections ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expense_deductions ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.investor_transactions ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.usd_treasury_transactions ADD COLUMN IF NOT EXISTS statement text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260702163110_e5b75a16-f608-4854-9692-d14b52fe4573.sql  (9 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260702163110_e5b75a16-f608-4854-9692-d14b52fe4573.sql'; END $$;

DO $mig$
BEGIN
-- Opening balance support for merchants, currency suppliers, and cash boxes.

-- 1) merchants: add opening balance fields
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text,
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2) currency_suppliers: add opening balance fields
ALTER TABLE public.currency_suppliers
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text,
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 3) cash_boxes: add opening balance fields (currency already exists on the box itself)
ALTER TABLE public.cash_boxes
  ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 4) tag columns on ledger tables so we can identify opening rows and dedupe them.
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS source_service_type text,
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS opening_currency text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions
  ADD COLUMN IF NOT EXISTS source_service_type text,
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS opening_currency text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.usd_treasury_transactions
  ADD COLUMN IF NOT EXISTS source_service_type text,
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES public.cash_boxes(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 5) partial unique indexes: prevent duplicate opening rows per entity+currency.
CREATE UNIQUE INDEX IF NOT EXISTS ux_merchant_opening_row
  ON public.merchant_cash_collections (merchant_id, opening_currency, source_service_type)
  WHERE source_service_type IN ('opening_debit','opening_credit');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE UNIQUE INDEX IF NOT EXISTS ux_currency_supplier_opening_row
  ON public.currency_supplier_transactions (supplier_id, opening_currency, source_service_type)
  WHERE source_service_type IN ('opening_debit','opening_credit');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_box_opening_row
  ON public.usd_treasury_transactions (cash_box_id, source_service_type)
  WHERE source_service_type = 'opening';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260702173134_03b81112-16c8-4d87-99b0-ab584fd45c45.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260702173134_03b81112-16c8-4d87-99b0-ab584fd45c45.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.issuing_companies
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.transactions t
   SET currency = COALESCE(a.opening_currency, 'EGP')
  FROM public.agents a
 WHERE t.agent_id = a.id
   AND t.source_service_type IN ('opening_debit', 'opening_credit');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.company_transactions ct
   SET currency = COALESCE(c.opening_currency, 'EGP')
  FROM public.issuing_companies c
 WHERE ct.company_id = c.id
   AND ct.source_service_type IN ('opening_debit', 'opening_credit');
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260702192359_af1f9bf2-0881-4a0c-816b-a65cec71c10f.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260702192359_af1f9bf2-0881-4a0c-816b-a65cec71c10f.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions DROP CONSTRAINT currency_supplier_transactions_tx_type_check;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions ADD CONSTRAINT currency_supplier_transactions_tx_type_check CHECK (tx_type = ANY (ARRAY['شراء عملة'::text, 'بيع عملة'::text, 'رصيد سابق'::text]));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260702225433_93f6d26e-e5cf-41eb-a43f-341590fc0cf2.sql  (15 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260702225433_93f6d26e-e5cf-41eb-a43f-341590fc0cf2.sql'; END $$;

DO $mig$
BEGIN
-- 1. Add cancellation columns to financial tables
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.expense_deductions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.usd_treasury_transactions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.merchant_cash_collections
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.payment_splits
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- 2. Audit log table
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('cancel','restore','edit','delete')),
  reason text,
  reference_no text,
  entity_type text,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  performed_by uuid REFERENCES auth.users(id),
  performed_at timestamptz NOT NULL DEFAULT now()
);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_financial_audit_log_record
  ON public.financial_audit_log(table_name, record_id);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE INDEX IF NOT EXISTS idx_financial_audit_log_performed_at
  ON public.financial_audit_log(performed_at DESC);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT SELECT, INSERT ON public.financial_audit_log TO authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT ALL ON public.financial_audit_log TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "audit log readable by authenticated"
  ON public.financial_audit_log FOR SELECT
  TO authenticated USING (true);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "audit log insertable by authenticated"
  ON public.financial_audit_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = performed_by);
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260702225456_418f578c-2d73-4104-aab3-b19f5a36e7f5.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260702225456_418f578c-2d73-4104-aab3-b19f5a36e7f5.sql'; END $$;

DO $mig$
BEGIN
CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  sign_new int := CASE WHEN COALESCE(NEW.direction,'in') = 'out' THEN -1 ELSE 1 END;
  sign_old int := CASE WHEN COALESCE(OLD.direction,'in') = 'out' THEN -1 ELSE 1 END;
  amt_new numeric := CASE WHEN NEW.cancelled_at IS NULL THEN COALESCE(NEW.amount,0) ELSE 0 END;
  amt_old numeric := CASE WHEN OLD.cancelled_at IS NULL THEN COALESCE(OLD.amount,0) ELSE 0 END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cash_box_id IS NOT NULL AND amt_new <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * amt_new,
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.cash_box_id IS NOT NULL AND amt_old <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * amt_old,
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cash_box_id IS NOT NULL AND amt_old <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) - sign_old * amt_old,
             updated_at = now()
       WHERE id = OLD.cash_box_id;
    END IF;
    IF NEW.cash_box_id IS NOT NULL AND amt_new <> 0 THEN
      UPDATE public.cash_boxes
         SET balance = COALESCE(balance,0) + sign_new * amt_new,
             updated_at = now()
       WHERE id = NEW.cash_box_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260703130439_d351eb94-d2ae-4512-a945-2df49495d5a7.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260703130439_d351eb94-d2ae-4512-a945-2df49495d5a7.sql'; END $$;

DO $mig$
BEGIN
-- Allow 'create' action in financial audit log
ALTER TABLE public.financial_audit_log DROP CONSTRAINT IF EXISTS financial_audit_log_action_check;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.financial_audit_log
  ADD CONSTRAINT financial_audit_log_action_check
  CHECK (action IN ('create','cancel','restore','edit','delete'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260703151624_e4f5cd28-212a-4d18-9f28-7959a56ee3e6.sql  (3 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260703151624_e4f5cd28-212a-4d18-9f28-7959a56ee3e6.sql'; END $$;

DO $mig$
BEGIN
-- Tighten financial_audit_log SELECT policy to require audit_log_view permission
CREATE OR REPLACE FUNCTION public.can_view_audit_log(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _uid
      AND (
        p.is_super_admin = true
        OR (p.permissions ? 'audit_log_view'
            AND (
              (p.permissions->'audit_log_view') = 'true'::jsonb
              OR (p.permissions->'audit_log_view'->>'view') = 'true'
            ))
      )
  )
  OR public.has_role(_uid, 'admin'::public.app_role);
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP POLICY IF EXISTS "audit log readable by authenticated" ON public.financial_audit_log;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE POLICY "audit log readable by authorized users"
  ON public.financial_audit_log
  FOR SELECT
  TO authenticated
  USING (public.can_view_audit_log(auth.uid()));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260703152114_fe430c30-818b-4976-96c3-be8e93bc7eea.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260703152114_fe430c30-818b-4976-96c3-be8e93bc7eea.sql'; END $$;

DO $mig$
BEGIN
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'merchants','merchant_cash_collections',
    'company_transactions',
    'currency_suppliers','currency_supplier_transactions',
    'expenses','expense_deductions',
    'investors','investor_transactions',
    'usd_treasury_transactions',
    'financial_audit_log'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260703153946_65a23997-eeb0-48ab-82ac-f312229208b5.sql  (2 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260703153946_65a23997-eeb0-48ab-82ac-f312229208b5.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions
  DROP CONSTRAINT IF EXISTS currency_supplier_transactions_tx_type_check;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.currency_supplier_transactions
  ADD CONSTRAINT currency_supplier_transactions_tx_type_check
  CHECK (tx_type = ANY (ARRAY[
    'شراء عملة'::text,
    'بيع عملة'::text,
    'رصيد سابق'::text,
    'دفع نقدية'::text,
    'استلام نقدية'::text
  ]));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260704004009_00e2959b-35d5-48e0-a1de-d9ad12a2bd58.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260704004009_00e2959b-35d5-48e0-a1de-d9ad12a2bd58.sql'; END $$;

DO $mig$
BEGIN
-- Guarantee that no cash box balance can ever go below zero,
-- regardless of which code path performs the update.
CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old numeric := COALESCE(OLD.balance, 0);
  v_new numeric := COALESCE(NEW.balance, 0);
  v_delta numeric;
  v_shortfall numeric;
  v_name text := COALESCE(NEW.name, OLD.name, '—');
  v_currency text := COALESCE(NEW.currency, OLD.currency, '');
BEGIN
  IF v_new < 0 THEN
    v_delta := v_old - v_new;         -- amount being deducted
    v_shortfall := -v_new;            -- how much it goes below zero
    RAISE EXCEPTION
      'INSUFFICIENT_CASH_BOX_BALANCE: لا يمكن تنفيذ العملية. رصيد خزنة (%) بعملة (%) غير كافٍ لإتمام عملية الصرف. الرصيد الحالي: % %  |  المطلوب: % %  |  العجز: % %',
      v_name, v_currency,
      v_old, v_currency,
      v_delta, v_currency,
      v_shortfall, v_currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS trg_cash_boxes_non_negative ON public.cash_boxes;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- BEFORE UPDATE so the balance write is aborted before any dependent
-- side effects commit; because the trigger raises inside the same
-- transaction as the caller (payment_splits, currency ops, transfers,
-- future services), the entire operation is rolled back atomically.
CREATE TRIGGER trg_cash_boxes_non_negative
BEFORE UPDATE OF balance ON public.cash_boxes
FOR EACH ROW
WHEN (NEW.balance IS DISTINCT FROM OLD.balance)
EXECUTE FUNCTION public.enforce_cash_box_non_negative_balance();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Also guard direct INSERTs that seed a negative balance.
CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance_ins()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.balance, 0) < 0 THEN
    RAISE EXCEPTION
      'INSUFFICIENT_CASH_BOX_BALANCE: لا يمكن إنشاء خزنة (%) بعملة (%) برصيد سالب.',
      COALESCE(NEW.name,'—'), COALESCE(NEW.currency,'')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
DROP TRIGGER IF EXISTS trg_cash_boxes_non_negative_ins ON public.cash_boxes;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
CREATE TRIGGER trg_cash_boxes_non_negative_ins
BEFORE INSERT ON public.cash_boxes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cash_box_non_negative_balance_ins();
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260704004807_19b20995-3dc7-46ff-a221-16ca119260da.sql  (1 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260704004807_19b20995-3dc7-46ff-a221-16ca119260da.sql'; END $$;

DO $mig$
BEGIN
CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old numeric := COALESCE(OLD.balance, 0);
  v_new numeric := COALESCE(NEW.balance, 0);
  v_delta numeric := v_old - v_new;      -- positive => outflow, negative => inflow
  v_shortfall numeric;
  v_name text := COALESCE(NEW.name, OLD.name, '—');
  v_currency text := COALESCE(NEW.currency, OLD.currency, '');
BEGIN
  -- Debug trace (visible via `psql` server logs / edge logs).
  RAISE LOG
    'cash_box guard | id=% name=% currency=% old_balance=% new_balance=% delta(out)=%',
    COALESCE(NEW.id, OLD.id), v_name, v_currency, v_old, v_new, v_delta;

  -- Block ONLY outflows (v_new < v_old) that leave the balance negative.
  -- Inflows / deposits are always allowed — even into an overdrawn box —
  -- so historical negative balances can be reduced without being locked out.
  IF v_delta > 0 AND v_new < 0 THEN
    v_shortfall := -v_new;
    RAISE EXCEPTION
      'INSUFFICIENT_CASH_BOX_BALANCE: لا يمكن تنفيذ العملية. رصيد خزنة (%) بعملة (%) غير كافٍ لإتمام عملية الصرف. الرصيد الحالي: % %  |  المطلوب: % %  |  العجز: % %',
      v_name, v_currency,
      v_old, v_currency,
      v_delta, v_currency,
      v_shortfall, v_currency
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260704012151_02914c35-57a8-429c-b5d8-eda6e8470f60.sql  (8 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260704012151_02914c35-57a8-429c-b5d8-eda6e8470f60.sql'; END $$;

DO $mig$
BEGIN
-- Add stable method_key identifier to cash_boxes so cash box selection no longer
-- depends on Arabic name substring matching. Nullable + partial unique index
-- to preserve full backward compatibility with existing data.
ALTER TABLE public.cash_boxes
  ADD COLUMN IF NOT EXISTS method_key text;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
COMMENT ON COLUMN public.cash_boxes.method_key IS
  'Stable identifier used by the app to resolve which cash box a payment method/currency maps to. Examples: company_cash, company_instapay, company_usd, company_lyd. Nullable to keep legacy rows working via name-based fallback.';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Prevent two active boxes claiming the same method_key.
CREATE UNIQUE INDEX IF NOT EXISTS cash_boxes_method_key_uniq
  ON public.cash_boxes (method_key)
  WHERE method_key IS NOT NULL;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Backfill stable keys for the known canonical boxes based on their current
-- name+currency pairing. This does NOT touch balances, payment splits, or any
-- financial data — only the new descriptor column.
UPDATE public.cash_boxes
   SET method_key = 'company_cash'
 WHERE method_key IS NULL
   AND currency  = 'EGP'
   AND name LIKE '%نقدي%'
   AND name LIKE '%الشركة%';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.cash_boxes
   SET method_key = 'company_instapay'
 WHERE method_key IS NULL
   AND currency  = 'EGP'
   AND name LIKE '%إنستا%'
   AND name LIKE '%الشركة%';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.cash_boxes
   SET method_key = 'company_usd'
 WHERE method_key IS NULL
   AND currency  = 'USD'
   AND name LIKE '%الرئيسية%';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.cash_boxes
   SET method_key = 'company_lyd'
 WHERE method_key IS NULL
   AND currency  = 'LYD'
   AND name LIKE '%الرئيسية%';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
-- Legacy orphan EGP main box (from the unification migration) intentionally
-- left with method_key = NULL so no new operation resolves to it.;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260704122926_c0892456-35b5-4b60-8a0d-94266ca19286.sql  (3 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260704122926_c0892456-35b5-4b60-8a0d-94266ca19286.sql'; END $$;

DO $mig$
BEGIN
ALTER TABLE public.company_pricing_rules
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
UPDATE public.company_pricing_rules
   SET currency = 'EGP'
 WHERE currency IS NULL OR btrim(currency) = '';
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
ALTER TABLE public.company_pricing_rules
  ADD CONSTRAINT company_pricing_rules_currency_chk
  CHECK (currency IN ('EGP','USD','LYD'));
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

-- ---------------------------------------------------------------------
-- Migration: 20260704201536_78de431d-b36c-4b34-8bb6-22fdb696dcb8.sql  (6 statement(s))
-- ---------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE '-- applying 20260704201536_78de431d-b36c-4b34-8bb6-22fdb696dcb8.sql'; END $$;

DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
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
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
REVOKE ALL ON FUNCTION public.restore_disable_guards() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
REVOKE ALL ON FUNCTION public.restore_enable_guards() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT EXECUTE ON FUNCTION public.restore_disable_guards() TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;
DO $mig$
BEGIN
GRANT EXECUTE ON FUNCTION public.restore_enable_guards() TO service_role;
EXCEPTION
  WHEN duplicate_table OR duplicate_object OR duplicate_column OR duplicate_function OR duplicate_schema OR duplicate_alias OR duplicate_database OR unique_violation THEN
    RAISE NOTICE 'skip (already exists): %', SQLERRM;
  WHEN undefined_object OR undefined_table OR undefined_column OR undefined_function THEN
    RAISE NOTICE 'skip (missing target): %', SQLERRM;
END $mig$;

DO $$
BEGIN
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '  All migrations applied successfully (idempotent).  ';
  RAISE NOTICE '  Existing objects were skipped, missing ones added. ';
  RAISE NOTICE '=====================================================';
END $$;
