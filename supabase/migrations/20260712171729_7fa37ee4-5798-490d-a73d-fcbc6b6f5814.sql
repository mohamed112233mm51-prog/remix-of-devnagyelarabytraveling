ALTER TABLE public.executions
  ADD COLUMN IF NOT EXISTS fx_locks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fx_locked_at timestamptz;
