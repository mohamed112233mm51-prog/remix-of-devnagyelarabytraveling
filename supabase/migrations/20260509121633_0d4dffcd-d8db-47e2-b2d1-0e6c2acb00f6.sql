ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE public.company_transactions ADD COLUMN IF NOT EXISTS service_type text;