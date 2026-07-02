ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP';

ALTER TABLE public.company_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';

ALTER TABLE public.issuing_companies
  ADD COLUMN IF NOT EXISTS opening_currency text NOT NULL DEFAULT 'EGP';

UPDATE public.transactions t
   SET currency = COALESCE(a.opening_currency, 'EGP')
  FROM public.agents a
 WHERE t.agent_id = a.id
   AND t.source_service_type IN ('opening_debit', 'opening_credit');

UPDATE public.company_transactions ct
   SET currency = COALESCE(c.opening_currency, 'EGP')
  FROM public.issuing_companies c
 WHERE ct.company_id = c.id
   AND ct.source_service_type IN ('opening_debit', 'opening_credit');
