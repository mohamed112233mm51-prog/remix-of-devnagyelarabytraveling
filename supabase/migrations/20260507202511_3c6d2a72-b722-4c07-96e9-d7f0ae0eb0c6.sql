ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS national_id text;
ALTER TABLE public.approvals DROP COLUMN IF EXISTS approval_type;
ALTER TABLE public.approvals ALTER COLUMN status SET DEFAULT 'سريعة';