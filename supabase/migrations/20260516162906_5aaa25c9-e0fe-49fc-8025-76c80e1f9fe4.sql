CREATE TABLE public.agent_service_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  service_type text NOT NULL,
  company_price numeric NOT NULL DEFAULT 0,
  agent_price numeric NOT NULL DEFAULT 0,
  company_percentage numeric NOT NULL DEFAULT 0,
  company_profit_value numeric NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, service_type)
);

ALTER TABLE public.agent_service_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.agent_service_pricing FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_agent_service_pricing_agent ON public.agent_service_pricing(agent_id);

-- Snapshot fields on flights
ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS company_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_profit_value numeric NOT NULL DEFAULT 0;

-- Snapshot fields on approvals
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS company_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_profit_value numeric NOT NULL DEFAULT 0;