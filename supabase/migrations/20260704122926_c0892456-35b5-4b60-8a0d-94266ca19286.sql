ALTER TABLE public.company_pricing_rules
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EGP';

UPDATE public.company_pricing_rules
   SET currency = 'EGP'
 WHERE currency IS NULL OR btrim(currency) = '';

ALTER TABLE public.company_pricing_rules
  ADD CONSTRAINT company_pricing_rules_currency_chk
  CHECK (currency IN ('EGP','USD','LYD'));