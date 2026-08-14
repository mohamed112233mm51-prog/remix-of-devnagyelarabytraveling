ALTER TABLE public.currency_supplier_transactions
  ADD COLUMN IF NOT EXISTS commission_amount numeric NOT NULL DEFAULT 0;