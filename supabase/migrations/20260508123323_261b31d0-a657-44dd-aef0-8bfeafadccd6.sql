
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS travel_statement text;
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS travel_statement text;
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS authority text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS travel_statement text;
