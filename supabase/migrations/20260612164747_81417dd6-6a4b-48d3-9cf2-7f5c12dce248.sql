
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text;

ALTER TABLE public.issuing_companies
  ADD COLUMN IF NOT EXISTS opening_debit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date,
  ADD COLUMN IF NOT EXISTS opening_note text;
