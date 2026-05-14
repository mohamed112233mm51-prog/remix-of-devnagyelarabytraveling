-- Issuing companies (suppliers)
CREATE TABLE public.issuing_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  phone text,
  whatsapp text,
  service_type text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.issuing_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.issuing_companies FOR ALL USING (true) WITH CHECK (true);

-- Company financial transactions (money paid OUT to supplier)
CREATE TABLE public.company_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  destination text,
  count integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  trip_value numeric NOT NULL DEFAULT 0,
  instapay_amount numeric NOT NULL DEFAULT 0,
  cash_amount numeric NOT NULL DEFAULT 0,
  mobile_cash_amount numeric NOT NULL DEFAULT 0,
  mobile_cash_net_amount numeric NOT NULL DEFAULT 0,
  total_paid numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.company_transactions FOR ALL USING (true) WITH CHECK (true);

-- Link approvals to issuing company by id (keep existing issuing_company text for backward compat)
ALTER TABLE public.approvals ADD COLUMN issuing_company_id uuid;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.issuing_companies;
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_transactions;