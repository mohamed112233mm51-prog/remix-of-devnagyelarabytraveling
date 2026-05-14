ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS instapay_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mobile_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mobile_cash_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid numeric NOT NULL DEFAULT 0;