ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS approval_validity_enabled boolean NOT NULL DEFAULT false;

INSERT INTO public.app_settings (key, value)
VALUES ('approval_validity_days', '{"v": 30}'::jsonb)
ON CONFLICT (key) DO NOTHING;