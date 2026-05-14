ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS supports_instapay boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_cash_wallet boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_physical_cash boolean NOT NULL DEFAULT true;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_id uuid;

ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS merchant_id uuid;