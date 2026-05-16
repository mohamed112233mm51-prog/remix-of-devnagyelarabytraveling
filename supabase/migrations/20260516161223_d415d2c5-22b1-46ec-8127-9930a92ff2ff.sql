ALTER TABLE public.usd_treasury_transactions
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS merchant_id uuid;