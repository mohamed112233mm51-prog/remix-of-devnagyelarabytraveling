
ALTER TABLE public.backup_logs
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Backfill started_at from created_at for old rows
UPDATE public.backup_logs SET started_at = created_at WHERE started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_backup_logs_trigger_type ON public.backup_logs(trigger_type);
