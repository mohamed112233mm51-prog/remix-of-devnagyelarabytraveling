-- Add new payment columns to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_cash_amount numeric NOT NULL DEFAULT 0;

UPDATE public.transactions
SET arabic_tourism_cash_amount = COALESCE(NULLIF(arabic_tourism_cash_amount,0), mobile_cash_amount),
    arabic_tourism_cash_net_amount = COALESCE(NULLIF(arabic_tourism_cash_net_amount,0), mobile_cash_net_amount)
WHERE mobile_cash_amount IS NOT NULL;

-- Add new payment columns to company_transactions
ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arabic_tourism_cash_net_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_cash_amount numeric NOT NULL DEFAULT 0;

UPDATE public.company_transactions
SET arabic_tourism_cash_amount = COALESCE(NULLIF(arabic_tourism_cash_amount,0), mobile_cash_amount),
    arabic_tourism_cash_net_amount = COALESCE(NULLIF(arabic_tourism_cash_net_amount,0), mobile_cash_net_amount)
WHERE mobile_cash_amount IS NOT NULL;

-- Merchants table
CREATE TABLE IF NOT EXISTS public.merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_name text NOT NULL,
  phone text,
  whatsapp text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.merchants FOR ALL USING (true) WITH CHECK (true);

-- Merchant cash collections
CREATE TABLE IF NOT EXISTS public.merchant_cash_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.merchant_cash_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.merchant_cash_collections FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.merchants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_cash_collections;