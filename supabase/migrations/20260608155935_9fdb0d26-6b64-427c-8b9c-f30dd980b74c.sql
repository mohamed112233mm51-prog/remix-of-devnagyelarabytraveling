ALTER TABLE public.currency_supplier_transactions 
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS payment_splits jsonb NOT NULL DEFAULT '[]'::jsonb;