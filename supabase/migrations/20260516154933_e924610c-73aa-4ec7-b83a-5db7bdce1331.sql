
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

ALTER TABLE public.usd_treasury_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.usd_treasury_transactions FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.usd_treasury_transactions;

ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS usd_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate_used numeric,
  ADD COLUMN IF NOT EXISTS payment_currency text;
