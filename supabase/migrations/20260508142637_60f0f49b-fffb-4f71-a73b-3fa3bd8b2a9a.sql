ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS governorate text;

ALTER TABLE public.agents DROP COLUMN IF EXISTS airline;