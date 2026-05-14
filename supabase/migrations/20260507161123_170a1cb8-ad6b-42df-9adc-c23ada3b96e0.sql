
-- Agents (the only "client-like" entity — agents are the company's customers)
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  phone text,
  airline text,
  status text NOT NULL DEFAULT 'نشط',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_name text NOT NULL,
  passport text,
  dob date,
  airline text,
  destination text,
  travel_date date,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'محجوز',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_name text NOT NULL,
  passport text,
  dob date,
  destination text,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  approval_type text NOT NULL DEFAULT 'طيران',
  submit_date date,
  issue_date date,
  status text NOT NULL DEFAULT 'معلق',
  government_fee numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  destination text,
  count integer NOT NULL DEFAULT 1,
  price numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'نقدي',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.flights(agent_id);
CREATE INDEX ON public.approvals(agent_id);
CREATE INDEX ON public.transactions(agent_id);

-- RLS: open access (no auth in MVP)
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.flights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.transactions FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.flights;
ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
