
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS funding_source text,
  ADD COLUMN IF NOT EXISTS merchant_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS usd_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric;

ALTER TABLE public.expense_deductions
  ADD COLUMN IF NOT EXISTS funding_source text,
  ADD COLUMN IF NOT EXISTS merchant_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS usd_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric;
