ALTER TABLE public.payment_splits
  ADD COLUMN IF NOT EXISTS gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_commission_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_commission_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric NOT NULL DEFAULT 0;