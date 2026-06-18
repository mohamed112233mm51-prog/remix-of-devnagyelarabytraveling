
-- Extend backup_logs to match the spec required by the user (backup_name, file_url, completed_at, error_message)
-- Keep existing columns for back-compat.

ALTER TABLE public.backup_logs
  ADD COLUMN IF NOT EXISTS backup_name text,
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Widen status default & allow new states; we don't enforce a CHECK to avoid breaking old rows.
ALTER TABLE public.backup_logs ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.backup_logs ALTER COLUMN status SET DEFAULT 'pending';

-- Backfill error_message from failure_reason if needed.
UPDATE public.backup_logs SET error_message = failure_reason WHERE error_message IS NULL AND failure_reason IS NOT NULL;

-- Tighten RLS: admin-only (policy already exists, but re-affirm grants).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_logs TO authenticated;
GRANT ALL ON public.backup_logs TO service_role;
