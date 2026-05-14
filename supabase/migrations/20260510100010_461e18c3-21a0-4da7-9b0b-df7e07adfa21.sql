CREATE TABLE public.investors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_name text NOT NULL,
  phone text,
  whatsapp text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.investors FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.investor_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investor_id uuid NOT NULL,
  transaction_type text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  payment_method text,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.investor_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.investor_transactions FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.investors;
ALTER PUBLICATION supabase_realtime ADD TABLE public.investor_transactions;