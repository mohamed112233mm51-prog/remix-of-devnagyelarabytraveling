ALTER TABLE public.flights
  ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_value numeric NOT NULL DEFAULT 0;

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_value numeric NOT NULL DEFAULT 0;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS source_service_type text;

ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS source_service_id uuid,
  ADD COLUMN IF NOT EXISTS source_service_type text;

CREATE INDEX IF NOT EXISTS idx_transactions_source_service_id ON public.transactions (source_service_id);
CREATE INDEX IF NOT EXISTS idx_company_transactions_source_service_id ON public.company_transactions (source_service_id);